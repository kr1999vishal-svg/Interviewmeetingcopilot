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

export async function registerUser(req: Request, res: Response) {
  try {
    const { email, name, picture } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (existingUser) {
      // Update last seen
      await supabase
        .from('users')
        .update({ last_seen: new Date().toISOString() })
        .eq('email', email);
      return res.json({ success: true, user: existingUser });
    }

    // Create new user
    const { data, error } = await supabase
      .from('users')
      .insert({
        email,
        display_name: name || email.split('@')[0],
        picture_url: picture || '',
        meeting_count: 0,
        file_count: 0,
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        total_usage_seconds: 0,
        free_trial_used: false,
      })
      .select()
      .single();

    if (error) {
      console.log('Supabase error:', error.message);
      return res.status(500).json({ error: 'Failed to register user' });
    }

    res.json({ success: true, user: data });
  } catch (error) {
    console.log('Failed to register user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
}

export async function getPaymentPlans(req: Request, res: Response) {
  try {
    // Return only the 3 specific plans we want in the correct order
    const { data, error } = await supabase
      .from('payment_plans')
      .select('*')
      .in('name', ['Starter', 'Most Popular', 'Professional']);

    if (error) {
      console.log('Supabase error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch payment plans' });
    }

    // Sort in the correct order: Starter, Most Popular, Professional
    const sortOrder = ['Starter', 'Most Popular', 'Professional'];
    const sortedPlans = (data || []).sort((a, b) => {
      return sortOrder.indexOf(a.name) - sortOrder.indexOf(b.name);
    });

    res.json({ success: true, plans: sortedPlans });
  } catch (error) {
    console.log('Failed to get payment plans:', error);
    res.status(500).json({ error: 'Failed to get payment plans' });
  }
}

export async function createRazorpayOrder(req: Request, res: Response) {
  try {
    const { email, planId } = req.body;

    console.log('Creating Razorpay order for email:', email, 'planId:', planId);

    if (!email || !planId) {
      console.error('Missing email or planId');
      return res.status(400).json({ error: 'Email and planId are required' });
    }

    // Check if Razorpay credentials are configured
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error('Razorpay credentials not configured');
      return res.status(500).json({ error: 'Payment gateway not configured. Please contact support.' });
    }

    // Get plan details
    const { data: plan, error: planError } = await supabase
      .from('payment_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      console.error('Plan not found:', planError);
      return res.status(404).json({ error: 'Plan not found' });
    }

    console.log('Plan found:', plan.name, 'price:', plan.price_inr);

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      console.error('User not found for email:', email);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User found:', user.email);

    // Create Razorpay order (you'll need to implement actual Razorpay API call)
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount: plan.price_inr * 100, // Amount in paise
      currency: 'INR',
      receipt: `order_${user.id}_${plan.id}_${Date.now()}`,
      notes: {
        userId: user.id,
        planId: plan.id,
        email: email,
      },
    };

    console.log('Creating Razorpay order with options:', { ...options, key_secret: '***' });

    const order = await razorpay.orders.create(options);

    console.log('Razorpay order created successfully:', order.id);

    // Create pending transaction
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        razorpay_order_id: order.id,
        amount: plan.price_inr,
        currency: 'INR',
        status: 'pending',
      })
      .select()
      .single();

    if (txError) {
      console.log('Failed to create transaction:', txError.message);
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
      },
      plan,
    });
  } catch (error) {
    console.log('Failed to create Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
}

export async function verifyPayment(req: Request, res: Response) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify signature
    const crypto = require('crypto');
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Get transaction
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('razorpay_order_id', razorpay_order_id)
      .single();

    if (txError || !transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Update transaction
    const { error: updateError } = await supabase
      .from('payment_transactions')
      .update({
        razorpay_payment_id,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id);

    if (updateError) {
      console.log('Failed to update transaction:', updateError.message);
    }

    // Get plan details
    const { data: plan } = await supabase
      .from('payment_plans')
      .select('*')
      .eq('id', transaction.plan_id)
      .single();

    // Update user plan
    const planExpiresAt = new Date();
    planExpiresAt.setMinutes(planExpiresAt.getMinutes() + plan.duration_minutes);

    const { error: userError } = await supabase
      .from('users')
      .update({
        current_plan_id: plan.id,
        plan_expires_at: planExpiresAt.toISOString(),
      })
      .eq('email', email);

    if (userError) {
      console.log('Failed to update user plan:', userError.message);
    }

    res.json({ success: true, planExpiresAt: planExpiresAt.toISOString() });
  } catch (error) {
    console.log('Failed to verify payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
}

export async function getUserUsage(req: Request, res: Response) {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        *,
        payment_plans (id, name, duration_minutes, price_inr)
      `)
      .eq('email', email as string)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate remaining time
    let remainingSeconds = 0;
    let isFreeTrial = !user.free_trial_used;
    
    // Check if user has unlimited plan (Professional - duration_minutes = 0)
    const plan = user.payment_plans as any;
    const isUnlimited = plan && plan.duration_minutes === 0;
    
    if (isUnlimited && user.plan_expires_at) {
      const now = new Date();
      const expiresAt = new Date(user.plan_expires_at);
      // For unlimited, check if plan is still active
      if (expiresAt > now) {
        remainingSeconds = 999999; // Large number to indicate unlimited
      }
    } else if (user.plan_expires_at) {
      const now = new Date();
      const expiresAt = new Date(user.plan_expires_at);
      remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
    } else if (isFreeTrial) {
      remainingSeconds = 30; // 30 seconds free trial
    }

    res.json({
      success: true,
      user: {
        email: user.email,
        display_name: user.display_name,
        total_usage_seconds: user.total_usage_seconds,
        free_trial_used: user.free_trial_used,
        current_plan: user.payment_plans,
        plan_expires_at: user.plan_expires_at,
        remaining_seconds: remainingSeconds,
        is_free_trial: isFreeTrial,
      },
    });
  } catch (error) {
    console.log('Failed to get user usage:', error);
    res.status(500).json({ error: 'Failed to get user usage' });
  }
}

export async function updateUsage(req: Request, res: Response) {
  try {
    const { email, seconds } = req.body;

    if (!email || seconds === undefined) {
      return res.status(400).json({ error: 'Email and seconds are required' });
    }

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update usage
    const { error } = await supabase
      .from('users')
      .update({
        total_usage_seconds: user.total_usage_seconds + seconds,
        free_trial_used: user.free_trial_used || seconds >= 30,
      })
      .eq('email', email);

    if (error) {
      console.log('Failed to update usage:', error.message);
      return res.status(500).json({ error: 'Failed to update usage' });
    }

    res.json({ success: true });
  } catch (error) {
    console.log('Failed to update usage:', error);
    res.status(500).json({ error: 'Failed to update usage' });
  }
}

export async function checkApiHealth(req: Request, res: Response) {
  try {
    // Fetch admin config to get API keys
    const { data: config, error } = await supabase
      .from('admin_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !config) {
      return res.json({ 
        success: false, 
        ai: false, 
        stt: false, 
        error: 'Config not found' 
      });
    }

    const results = {
      ai: false,
      stt: false,
      aiError: null as string | null,
      sttError: null as string | null,
    };

    // Check AI API
    if (config.api_key) {
      try {
        const aiResponse = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${config.api_key}`,
          },
        });
        results.ai = aiResponse.ok;
        if (!aiResponse.ok) {
          results.aiError = 'AI API key invalid or expired';
        }
      } catch (err) {
        results.aiError = 'Failed to connect to AI API';
      }
    } else {
      results.aiError = 'AI API key not configured';
    }

    // Check STT API (same as AI for OpenAI Whisper)
    if (config.stt_api_key) {
      try {
        const sttResponse = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${config.stt_api_key}`,
          },
        });
        results.stt = sttResponse.ok;
        if (!sttResponse.ok) {
          results.sttError = 'STT API key invalid or expired';
        }
      } catch (err) {
        results.sttError = 'Failed to connect to STT API';
      }
    } else {
      results.sttError = 'STT API key not configured';
    }

    res.json({
      success: results.ai && results.stt,
      ai: results.ai,
      stt: results.stt,
      aiError: results.aiError,
      sttError: results.sttError,
    });
  } catch (error) {
    console.log('Failed to check API health:', error);
    res.status(500).json({ error: 'Failed to check API health' });
  }
}
