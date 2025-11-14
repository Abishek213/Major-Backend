import axios from 'axios';
import { paymentConfig } from '../config/payment.config.js';

export const initiateKhaltiPayment = async (payload) => {
  try {
    console.log('Initiating Khalti payment with payload:', {
      ...payload,
      customerInfo: {
        name: payload.customerInfo.name,
        email: payload.customerInfo.email
      }
    });

    const response = await axios.post(
      `${paymentConfig.khalti.apiUrl}/epayment/initiate/`,
      {
        ...payload,
        return_url: paymentConfig.webhooks.successUrl,
        website_url: paymentConfig.webhooks.websiteUrl,
        purchase_order_id: payload.transactionId,
        purchase_order_name: payload.productName
      },
      {
        headers: {
          'Authorization': `Key ${paymentConfig.khalti.secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Khalti payment initiated successfully');
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.detail || error.message;
    console.error('Khalti Payment Initiation Error:', {
      status: error.response?.status,
      message: errorMessage
    });
    throw new Error(`Payment initiation failed: ${errorMessage}`);
  }
};

export const verifyKhaltiPayment = async (pidx) => {
  try {
    const response = await axios.post(
      `${paymentConfig.khalti.apiUrl}/epayment/lookup/`,
      { pidx },
      {
        headers: {
          'Authorization': `Key ${paymentConfig.khalti.secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Khalti Verification Response:', response.data); // Add this line
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.detail || error.message;
    console.error('Khalti Payment Verification Error:', errorMessage);
    throw new Error(`Payment verification failed: ${errorMessage}`);
  }
};