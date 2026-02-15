export function calculateRiskScore(booking) {
  let risk = 0.1;
  if (booking.total > 1000) risk += 0.3;
  if (booking.total > 5000) risk += 0.3;
  return Math.min(risk, 1);
}

export function analyzeSentiment(comment) {
  const positiveWords = ["great", "good", "excellent", "amazing", "wonderful"];
  const negativeWords = ["bad", "terrible", "poor", "disappointing", "awful"];
  let score = 0;
  const words = comment?.toLowerCase().split(" ") || [];
  positiveWords.forEach((word) => {
    if (words.includes(word)) score += 0.2;
  });
  negativeWords.forEach((word) => {
    if (words.includes(word)) score -= 0.2;
  });
  return Math.max(-1, Math.min(1, score));
}

export function detectIssues(comment) {
  const issues = [];
  const issueKeywords = {
    parking: ["parking", "car", "park"],
    food: ["food", "drink", "beverage"],
    seating: ["seat", "sitting", "chair"],
    sound: ["sound", "audio", "music"],
    price: ["expensive", "price", "cost"],
  };
  const lowerComment = comment?.toLowerCase() || "";
  Object.keys(issueKeywords).forEach((issue) => {
    issueKeywords[issue].forEach((keyword) => {
      if (lowerComment.includes(keyword)) {
        issues.push(issue);
        return;
      }
    });
  });
  return [...new Set(issues)];
}
