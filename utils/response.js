export const sendSuccess = (res, data, status = 200) => {
  res.status(status).json({ success: true, ...data });
};

export const sendError = (res, error, status = 500, details = null) => {
  console.error(error);
  const response = {
    success: false,
    message: error.message || "Internal Server Error",
  };
  if (details) response.details = details;
  if (process.env.NODE_ENV === "development") response.stack = error.stack;
  res.status(status).json(response);
};
