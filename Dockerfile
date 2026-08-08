FROM node:22-alpine
WORKDIR /app
# Zero dependencies — there is nothing to npm install. Copy the source and run it.
COPY packages ./packages
COPY verafi ./verafi
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "verafi/server.js"]
