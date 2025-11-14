import { initiateKhaltiPayment, verifyKhaltiPayment } from './khalti.services.js';
import { initiateEsewaPayment, verifyEsewaPayment } from './esewa.services.js';
import { paymentConfig } from '../config/payment.config.js';

class PaymentService {
  async initiatePayment(paymentMethod, bookingData) {
    const basePayload = {
      amount: bookingData.totalAmount,
      transactionId: bookingData.bookingId,
      productName: `Booking for ${bookingData.eventName}`,
      customerInfo: bookingData.customerInfo
    };

    switch (paymentMethod.toLowerCase()) {
      case 'khalti':
        return await initiateKhaltiPayment({
          ...basePayload,
          amount: basePayload.amount * 100, // Convert to paisa
          return_url: paymentConfig.webhooks.successUrl,
          website_url: paymentConfig.webhooks.websiteUrl
        });

      case 'esewa':
        return await initiateEsewaPayment(basePayload);

      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
  }

  async verifyPayment(paymentMethod, verificationData) {
    switch (paymentMethod.toLowerCase()) {
      case 'khalti':
        return await verifyKhaltiPayment(verificationData.pidx);
      case 'esewa':
        return await verifyEsewaPayment(verificationData);
      default:
        throw new Error(`Unsupported payment method for verification: ${paymentMethod}`);
    }
  }
}

export default new PaymentService();