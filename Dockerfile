FROM node:18
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
CMD ["node", "dist/main.js"]
EXPOSE 3000
