import winston from "winston";

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// morgan stream adapter
const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export { logger, stream };
export default logger;
