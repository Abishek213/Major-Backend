import axios from 'axios';
import { paymentConfig } from '../config/payment.config.js';

export const initiateEsewaPayment = async (payload) => {
  try {
    const { amount, productDetails, transactionId } = payload;
    
    // eSewa requires a specific format for payment initiation
    const esewaPayload = {
      amt: amount,
      pdc: 0,
      psc: 0,
      txAmt: 0,
      tAmt: amount,
      pid: transactionId,
      scd: paymentConfig.esewa.merchantCode,
      su: paymentConfig.webhooks.successUrl,
      fu: paymentConfig.webhooks.failureUrl
    };

    // For eSewa, we return the form data that needs to be submitted
    return {
      paymentUrl: paymentConfig.esewa.apiUrl,
      formData: esewaPayload
    };
  } catch (error) {
    console.error('eSewa Payment Initiation Error:', error.message);
    throw error;
  }
};

export const verifyEsewaPayment = async (payload) => {
  try {
    const { oid, amt, refId } = payload;
    
    const verificationPayload = {
      merchantCode: paymentConfig.esewa.merchantCode,
      productId: oid,
      amount: amt,
      referenceId: refId
    };

    const response = await axios.get(
      paymentConfig.esewa.statusCheckUrl,
      { params: verificationPayload }
    );

    return response.data;
  } catch (error) {
    console.error('eSewa Payment Verification Error:', error.message);
    throw error;
  }
};