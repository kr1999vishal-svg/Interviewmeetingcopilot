-- Run this SQL in Supabase SQL Editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  picture_url TEXT,
  meeting_count INTEGER DEFAULT 0,
  file_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Payment and usage tracking
  total_usage_seconds INTEGER DEFAULT 0,
  free_trial_used BOOLEAN DEFAULT FALSE,
  current_plan_id UUID REFERENCES payment_plans(id),
  plan_expires_at TIMESTAMP WITH TIME ZONE
);

-- Payment plans table
CREATE TABLE IF NOT EXISTS payment_plans (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price_inr INTEGER NOT NULL,
  price_usd DECIMAL(10,2) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE
);

-- Payment transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES payment_plans(id),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'pending', -- pending, completed, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default payment plans
INSERT INTO payment_plans (name, duration_minutes, price_inr, price_usd, description) VALUES
  ('1 Minute', 1, 8, 0.10, '1 minute of meeting copilot'),
  ('30 Minutes', 30, 800, 10.00, '30 minutes of meeting copilot'),
  ('45 Minutes', 45, 880, 11.00, '45 minutes of meeting copilot'),
  ('60 Minutes', 60, 1200, 15.00, '60 minutes of meeting copilot')
ON CONFLICT DO NOTHING;

-- If the table already exists with old schema, add missing columns
DO $$
BEGIN
  -- Add missing columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'display_name') THEN
    ALTER TABLE users ADD COLUMN display_name TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'picture_url') THEN
    ALTER TABLE users ADD COLUMN picture_url TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'meeting_count') THEN
    ALTER TABLE users ADD COLUMN meeting_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'file_count') THEN
    ALTER TABLE users ADD COLUMN file_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_seen') THEN
    ALTER TABLE users ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
  
  -- Add payment and usage tracking columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'total_usage_seconds') THEN
    ALTER TABLE users ADD COLUMN total_usage_seconds INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'free_trial_used') THEN
    ALTER TABLE users ADD COLUMN free_trial_used BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'current_plan_id') THEN
    ALTER TABLE users ADD COLUMN current_plan_id UUID REFERENCES payment_plans(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'plan_expires_at') THEN
    ALTER TABLE users ADD COLUMN plan_expires_at TIMESTAMP WITH TIME ZONE;
  END IF;
  
  -- Rename old columns only if they exist AND new columns don't exist
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'display_name') THEN
    ALTER TABLE users RENAME COLUMN name TO display_name;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'picture') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'picture_url') THEN
    ALTER TABLE users RENAME COLUMN picture TO picture_url;
  END IF;
END $$;

-- Admin config table
CREATE TABLE IF NOT EXISTS admin_config (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  backend_url TEXT DEFAULT 'http://localhost:4000',
  ai_provider TEXT DEFAULT 'openai',
  api_key TEXT,
  model TEXT,
  stt_provider TEXT DEFAULT 'openai',
  stt_api_key TEXT,
  stt_model TEXT DEFAULT 'whisper-1',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Files table
CREATE TABLE IF NOT EXISTS files (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default admin config
INSERT INTO admin_config (backend_url, ai_provider, api_key, model, stt_provider, stt_api_key, stt_model)
VALUES ('http://localhost:4000', 'openai', '', '', 'openai', '', 'whisper-1')
ON CONFLICT DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
