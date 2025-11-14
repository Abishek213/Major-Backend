import dotenv from 'dotenv';
dotenv.config();

export const paymentConfig = {
  khalti: {
    secretKey: process.env.KHALTI_SECRET_KEY,
    publicKey: process.env.KHALTI_PUBLIC_KEY,

    apiUrl: 'https://a.khalti.com/api/v2'
  },
  esewa: {
    merchantCode: process.env.ESEWA_MERCHANT_CODE,
    paymentUrl: process.env.ESEWA_PAYMENT_URL
  },
  webhooks: {
    successUrl: process.env.SUCCESS_URL,
    failureUrl: process.env.FAILURE_URL,
    websiteUrl: process.env.WEBSITE_URL
  }
};

// Validate required configuration
const requiredConfig = {
  'KHALTI_SECRET_KEY': paymentConfig.khalti.secretKey,
  'KHALTI_PUBLIC_KEY': paymentConfig.khalti.publicKey,
  'SUCCESS_URL': paymentConfig.webhooks.successUrl,
  'FAILURE_URL': paymentConfig.webhooks.failureUrl,
  'WEBSITE_URL': paymentConfig.webhooks.websiteUrl
};

Object.entries(requiredConfig).forEach(([key, value]) => {
  if (!value) {
    throw new Error(`Missing required payment configuration: ${key}`);
  }
});