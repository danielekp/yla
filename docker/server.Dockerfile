# Use a lightweight Python image
FROM python:3.9-slim

# Set working directory
WORKDIR /workspace

# Copy the app and the static server into the container
COPY ./src ./src
COPY ./utils/serve.py ./utils/serve.py

# Expose the port
EXPOSE 8000

# Run the static server (also proxies the Ollama model library)
CMD ["python3", "utils/serve.py", "8000", "--bind", "0.0.0.0"]
