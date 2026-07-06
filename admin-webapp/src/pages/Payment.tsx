import { useState, useEffect } from 'react';
import { getPaymentPlans, createRazorpayOrder, verifyPayment } from '../lib/api';

interface Plan {
  id: string;
  name: string;
  duration_minutes: number;
  price_inr: number;
  price_usd: number;
  description: string;
}

export default function Payment() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [email, setEmail] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadPlans();
    const userEmail = localStorage.getItem('userEmail');
    if (userEmail) setEmail(userEmail);
  }, []);

  async function loadPlans() {
    try {
      const data = await getPaymentPlans();
      setPlans(data.plans || []);
    } catch (error) {
      console.error('Failed to load plans:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePayment(plan: Plan) {
    if (!email) {
      alert('Please enter your email');
      return;
    }

    setProcessing(true);
    setSelectedPlan(plan);

    try {
      const response = await createRazorpayOrder(email, plan.id);
      
      const options = {
        key: response.order.key_id,
        amount: response.order.amount,
        currency: response.order.currency,
        name: 'Meeting Copilot',
        description: plan.name,
        order_id: response.order.id,
        handler: async function (response: any) {
          await verifyPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature,
            email
          );
          alert('Payment successful! You can now use Meeting Copilot.');
          setProcessing(false);
          setSelectedPlan(null);
        },
        prefill: {
          email: email,
        },
        theme: {
          color: '#4F46E5',
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function (response: any) {
        alert('Payment failed: ' + response.error.description);
        setProcessing(false);
        setSelectedPlan(null);
      });
      rzp.open();
    } catch (error) {
      console.error('Payment error:', error);
      alert('Failed to initiate payment. Please try again.');
      setProcessing(false);
      setSelectedPlan(null);
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Choose Your Plan</h1>
      <p className="text-gray-400 mb-8">Select a plan to continue using Meeting Copilot</p>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Your Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="your@email.com"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`bg-gray-800 rounded-lg border ${
              selectedPlan?.id === plan.id ? 'border-indigo-500' : 'border-gray-700'
            } p-6 hover:border-indigo-500 transition-colors cursor-pointer relative`}
            onClick={() => !processing && handlePayment(plan)}
          >
            {plan.name === 'Most Popular' && (
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white text-xs px-3 py-1 rounded-full">
                Most Popular
              </div>
            )}
            <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
            <div className="text-3xl font-bold text-indigo-400 mb-2">
              ${plan.price_usd.toFixed(2)}
            </div>
            <div className="text-sm text-gray-400 mb-4">
              ₹{plan.price_inr} INR
            </div>
            <p className="text-sm text-gray-300 mb-4">{plan.description}</p>
            <button
              disabled={processing}
              className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              {processing && selectedPlan?.id === plan.id ? 'Processing...' : 'Buy Now'}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-2">Free Trial</h3>
        <p className="text-gray-400">
          New users get 30 seconds of free usage to try Meeting Copilot. After the trial,
          you'll need to purchase a plan to continue.
        </p>
      </div>
    </div>
  );
}
