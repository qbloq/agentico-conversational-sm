#!/bin/bash

# Exit on error
set -e

# Configuration
REMOTE_HOST="api"
REMOTE_USER="root"
REMOTE_PATH="/apps/agentico_human-agent-app"
ZIP_NAME="human-agent-app.zip"

echo "🚀 Starting deployment of human-agent-app..."

# Step 1: Build locally
echo "🏗️  Building application..."
if [ ! -f ".env.production" ]; then
    echo "❌ Error: .env.production not found. Please create it before deploying."
    exit 1
fi
npm run build -- --mode production

# Step 2: Zip the dist folder
echo "📦 Creating archive from dist/..."
if [ ! -d "dist" ]; then
    echo "❌ Error: dist directory not found. Build might have failed."
    exit 1
fi

cd dist
zip -r ../$ZIP_NAME .
cd ..

# Step 3: SCP the zip file to remote
echo "📤 Uploading $ZIP_NAME to $REMOTE_HOST..."
scp $ZIP_NAME $REMOTE_USER@$REMOTE_HOST:/tmp/

# Step 4: Remote operations
echo "🔧 Executing remote commands..."
ssh $REMOTE_USER@$REMOTE_HOST << EOF
    # Ensure remote directory exists
    mkdir -p $REMOTE_PATH/dist
    
    # Delete current content of dist
    echo "🗑️  Clearing remote directory $REMOTE_PATH/dist..."
    rm -rf $REMOTE_PATH/dist/*
    
    # Unzip to remote path/dist
    echo "📂 Unzipping new version to $REMOTE_PATH/dist..."
    unzip -o /tmp/$ZIP_NAME -d $REMOTE_PATH/dist
    
    # Remove zip from tmp
    rm /tmp/$ZIP_NAME
    
    echo "✅ Remote deployment finished!"
EOF

# Step 5: Clean up local zip
echo "🧹 Cleaning up local archive..."
rm $ZIP_NAME

echo "✨ Deployment complete successfully!"
