# Use a lightweight Python image
FROM python:3.9-slim

# Set working directory
WORKDIR /workspace

# Copy the HTML files into the container
COPY . .

# Expose the port
EXPOSE 8000

# Run the Python HTTP server
CMD ["python3", "-m", "http.server", "8000"]
