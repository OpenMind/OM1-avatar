#!/bin/sh

# Create the env.js file with environment variables
echo "window.ENV = {" > /app/dist/env.js

# Process environment variables that start with VITE_
env | grep "^VITE_" | while IFS="=" read -r key value; do
  # Escape quotes and backslashes in the value for JavaScript
  escaped_value=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '  %s: "%s",\n' "$key" "$escaped_value" >> /app/dist/env.js
done

echo "};" >> /app/dist/env.js

# Debug: Show what was generated
echo "Generated env.js:"
cat /app/dist/env.js

# Start the preview server
exec npm run preview -- --host 0.0.0.0 --port 4173