#!/bin/bash

# Phase 1: Global Text Replacements for Sales Coach Pro Transformation
# This script systematically replaces all problematic terms with sales coaching terminology

echo "Starting Sales Coach Pro rebranding..."

# Text replacement mappings
declare -A replacements=(
    ["cheating"]="coaching"
    ["Cheating"]="Coaching"
    ["CHEATING"]="COACHING"
    ["Cheating Daddy"]="Sales Coach Pro"
    ["cheating-daddy"]="sales-coach-pro"
    ["cheatingdaddy"]="salescoachpro"
    ["cheddar"]="salesCoach"
    ["interview"]="sales-call"
    ["exam"]="meeting"
    ["fraud"]="assistance"
    ["stealth"]="focus-mode"
    ["hide"]="minimize"
)

# Files to process (exclude node_modules)
find src -type f \( -name "*.js" -o -name "*.html" -o -name "*.json" \) ! -path "*/node_modules/*" | while read file; do
    echo "Processing: $file"
    for old in "${!replacements[@]}"; do
        new="${replacements[$old]}"
        sed -i "s/$old/$new/g" "$file"
    done
done

# Update package.json
sed -i 's/"name": "cheating-daddy"/"name": "sales-coach-pro"/g' package.json
sed -i 's/"productName": "cheating-daddy"/"productName": "Sales Coach Pro"/g' package.json
sed -i 's/"description": "cheating daddy"/"description": "AI-powered sales coaching platform for real-time assistance during sales calls"/g' package.json

echo "Rebranding complete!"
