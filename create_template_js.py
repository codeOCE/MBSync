import base64
import os

def create_template_js():
    # Ensure the directory exists
    os.makedirs('lib', exist_ok=True)
    
    source_file = 'MB Change Request Form.xlsx'
    output_file = 'lib/template-data.js'
    
    if not os.path.exists(source_file):
        print(f"Error: '{source_file}' not found. Please place your Excel file in this folder.")
        return

    try:
        with open(source_file, 'rb') as f:
            # Read the file and convert to base64
            encoded = base64.b64encode(f.read()).decode('utf-8')
        
        # Create the Javascript file content
        js_content = f"window.TEMPLATE_DATA = '{encoded}';"
        
        with open(output_file, 'w') as f:
            f.write(js_content)
            
        print(f"Success! Created {output_file}")
        print("Link this file in your index.html before app.js")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    create_template_js()