import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://wseuwlhozbzwmmxeqzct.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY not set. Using in-memory storage as fallback.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
