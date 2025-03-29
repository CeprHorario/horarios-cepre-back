# Use Node.js 22 as base image
FROM node:22-alpine

# Set working directory to root
WORKDIR /app

# Install system dependencies for debugging
RUN apk add --no-cache bash curl

# Set environment variables
ENV HOST 0.0.0.0
ENV PORT 8080

# Copy dependency files first
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy the entire project
COPY . .

# Generate Prisma client if using Prisma
RUN npx prisma generate --schema=src/database/prisma/schema.prisma

# Build the project
RUN npm run build

# Expose port
EXPOSE 8080

# Debug step: list contents and show environment
RUN ls -la && env

# Run application
CMD ["sh", "-c", "node dist/main.js"]