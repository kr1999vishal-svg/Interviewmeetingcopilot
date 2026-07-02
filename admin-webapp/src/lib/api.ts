const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://interview-ai-backend-tlka.onrender.com';

export interface BackendConfig {
  backendUrl: string;
  aiProvider: 'openai' | 'anthropic' | 'google';
  apiKey: string;
  model?: string;
  sttProvider: 'openai' | 'anthropic' | 'google';
  sttApiKey: string;
  sttModel: string;
}

export async function saveBackendConfig(config: BackendConfig): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error('Failed to save backend config');
}

export async function getBackendConfig(): Promise<BackendConfig> {
  const response = await fetch(`${BACKEND_URL}/api/admin/config`);
  if (!response.ok) throw new Error('Failed to get backend config');
  return response.json();
}

export async function getUsers(): Promise<any[]> {
  const response = await fetch(`${BACKEND_URL}/api/admin/users`);
  if (!response.ok) throw new Error('Failed to get users');
  return response.json();
}

export async function getUsageStats(): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/stats`);
  if (!response.ok) throw new Error('Failed to get usage stats');
  return response.json();
}

export async function getPaymentPlans(): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/plans`);
  if (!response.ok) throw new Error('Failed to get payment plans');
  return response.json();
}

export async function createRazorpayOrder(email: string, planId: string): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, planId }),
  });
  if (!response.ok) throw new Error('Failed to create Razorpay order');
  return response.json();
}

export async function verifyPayment(
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string,
  email: string
): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature, email }),
  });
  if (!response.ok) throw new Error('Failed to verify payment');
  return response.json();
}

export async function getUserUsage(email: string): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/usage?email=${encodeURIComponent(email)}`);
  if (!response.ok) throw new Error('Failed to get user usage');
  return response.json();
}

export async function updateUsage(email: string, seconds: number): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/admin/usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, seconds }),
  });
  if (!response.ok) throw new Error('Failed to update usage');
  return response.json();
}
