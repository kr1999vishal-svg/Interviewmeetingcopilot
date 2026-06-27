import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { supabase } from '../lib/supabase.js';
import { extractTextFromFile } from '../services/fileProcessor.service.js';

// Configure multer for memory storage (for Supabase upload)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, Word, and Excel files are allowed.'));
    }
  }
});

export async function uploadFile(req: Request, res: Response) {
  try {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const userId = req.body.userId || 'anonymous';
      const fileExt = path.extname(req.file.originalname);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;
      const filePath = `${userId}/${fileName}`;
      
      try {
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from('uploads')
          .upload(filePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false
          });

        if (uploadError) {
          console.log('Supabase upload error:', uploadError);
          return res.status(500).json({ error: 'Failed to upload file to storage' });
        }

        // Extract text from file
        let content = '';
        try {
          // Save to temp file for text extraction
          const tempDir = path.join(process.cwd(), 'temp');
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          const tempPath = path.join(tempDir, fileName);
          fs.writeFileSync(tempPath, req.file.buffer);
          content = await extractTextFromFile(tempPath, req.file.mimetype);
          fs.unlinkSync(tempPath); // Clean up temp file
        } catch (extractError) {
          console.log('Text extraction error:', extractError);
          content = ''; // Continue without text extraction
        }

        // Save file metadata to database
        const { data: fileData, error: dbError } = await supabase
          .from('files')
          .insert({
            user_id: userId,
            file_name: req.file.originalname,
            storage_path: filePath,
            content: content,
          })
          .select()
          .single();

        if (dbError) {
          console.log('Database error:', dbError);
          // Delete from storage if database insert fails
          await supabase.storage.from('uploads').remove([filePath]);
          return res.status(500).json({ error: 'Failed to save file metadata' });
        }

        res.json({ 
          success: true, 
          fileId: fileData.id, 
          file: {
            id: fileData.id,
            originalName: req.file.originalname,
            size: req.file.size,
            content: content,
          }
        });
      } catch (supabaseError) {
        console.log('Supabase error, using fallback:', supabaseError);
        // Fallback to local storage if Supabase fails
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const localPath = path.join(uploadDir, fileName);
        fs.writeFileSync(localPath, req.file.buffer);
        
        const fileId = fileName;
        res.json({ success: true, fileId, file: { id: fileId, originalName: req.file.originalname } });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload file' });
  }
}

export async function getFile(req: Request, res: Response) {
  try {
    const { fileId } = req.params;
    
    // Try to get from Supabase
    const { data: fileData, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error || !fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get file from Supabase Storage
    const { data: file, error: downloadError } = await supabase
      .storage
      .from('uploads')
      .download(fileData.storage_path);

    if (downloadError) {
      return res.status(404).json({ error: 'File not found in storage' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.file_name}"`);
    res.send(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    console.log('Failed to get file:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
}

export async function getFilesByUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.log('Supabase error:', error);
      return res.json([]);
    }

    res.json(data || []);
  } catch (error) {
    console.log('Failed to get files:', error);
    res.json([]);
  }
}

export const uploadMiddleware = upload.single('file');
