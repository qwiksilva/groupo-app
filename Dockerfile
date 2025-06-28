# Dockerfile
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Start app using gunicorn
COPY seed_demo_data.py ./
COPY static/demo_images ./static/demo_images

CMD ["sh", "-c", "python seed_demo_data.py && gunicorn app:app --bind 0.0.0.0:8000"]