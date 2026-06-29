import { Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';

// Fallback in-memory storage if Supabase is not configured
let fallbackConfig = {
  backendUrl: 'http://localhost:4000',
  aiProvider: 'openai' as 'openai' | 'anthropic' | 'google',
  apiKey: '',
  model: '',
  sttProvider: 'openai' as 'openai' | 'anthropic' | 'google',
  sttApiKey: '',
  sttModel: 'whisper-1',
};

export async function getAdminConfig(req: Request, res: Response) {
  try {
    // Try to fetch from Supabase
    const { data, error } = await supabase
      .from('admin_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.log('Supabase error, using fallback:', error.message, error.code);
      return res.json(fallbackConfig);
    }

    const config = {
      backendUrl: data.backend_url,
      aiProvider: data.ai_provider,
      apiKey: data.api_key,
      model: data.model,
      sttProvider: data.stt_provider,
      sttApiKey: data.stt_api_key,
      sttModel: data.stt_model,
    };

    // Update fallback
    fallbackConfig = config;
    res.json(config);
  } catch (error) {
    console.log('Failed to get admin config, using fallback:', error);
    res.json(fallbackConfig);
  }
}

export async function saveAdminConfig(req: Request, res: Response) {
  try {
    const { backendUrl, aiProvider, apiKey, model, sttProvider, sttApiKey, sttModel } = req.body;
    
    const config = {
      backend_url: backendUrl || fallbackConfig.backendUrl,
      ai_provider: aiProvider || fallbackConfig.aiProvider,
      api_key: apiKey || fallbackConfig.apiKey,
      model: model || fallbackConfig.model,
      stt_provider: sttProvider || fallbackConfig.sttProvider,
      stt_api_key: sttApiKey || fallbackConfig.sttApiKey,
      stt_model: sttModel || fallbackConfig.sttModel,
    };

    // Try to save to Supabase
    const { data, error } = await supabase
      .from('admin_config')
      .upsert(config)
      .select()
      .single();

    if (error) {
      console.log('Supabase error, using fallback:', error.message);
      // Update fallback
      fallbackConfig = {
        backendUrl: config.backend_url,
        aiProvider: config.ai_provider,
        apiKey: config.api_key,
        model: config.model,
        sttProvider: config.stt_provider,
        sttApiKey: config.stt_api_key,
        sttModel: config.stt_model,
      };
      return res.json({ success: true, config: fallbackConfig });
    }

    const responseConfig = {
      backendUrl: data.backend_url,
      aiProvider: data.ai_provider,
      apiKey: data.api_key,
      model: data.model,
      sttProvider: data.stt_provider,
      sttApiKey: data.stt_api_key,
      sttModel: data.stt_model,
    };

    // Update fallback
    fallbackConfig = responseConfig;
    res.json({ success: true, config: responseConfig });
  } catch (error) {
    console.log('Failed to save admin config:', error);
    res.status(500).json({ error: 'Failed to save admin config' });
  }
}

export async function getUsers(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.log('Supabase error:', error.message);
      return res.json([]);
    }

    res.json(data || []);
  } catch (error) {
    console.log('Failed to get users:', error);
    res.json([]);
  }
}

export async function getUsageStats(req: Request, res: Response) {
  try {
    // Get user count
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Get file count
    const { count: totalFiles } = await supabase
      .from('files')
      .select('*', { count: 'exact', head: true });

    const stats = {
      totalUsers: totalUsers || 0,
      activeMeetings: 0, // Can be tracked separately
      totalFiles: totalFiles || 0,
      apiCalls: 0, // Can be tracked separately
      recentActivity: [], // Can be tracked separately
    };
    res.json(stats);
  } catch (error) {
    console.log('Failed to get usage stats:', error);
    res.json({
      totalUsers: 0,
      activeMeetings: 0,
      totalFiles: 0,
      apiCalls: 0,
      recentActivity: [],
    });
  }
}
