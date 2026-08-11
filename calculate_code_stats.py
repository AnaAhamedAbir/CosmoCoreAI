import os
from collections import defaultdict

def calculate_code_stats(root_dir="."):
    # Directories to ignore
    ignore_dirs = {
        '.git', 'node_modules', '__pycache__', 'venv', '.venv', 'env', 
        'dist', 'build', '.next', 'coverage', '.idea', '.vscode'
    }

    # File extensions to count (add or remove as needed)
    valid_extensions = {
        '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.sass', 
        '.json', '.vue', '.svelte', '.py', '.go', '.java', '.cpp', '.c', 
        '.h', '.php', '.rb', '.sql', '.yaml', '.yml', '.md', '.sh'
    }

    stats_by_ext = defaultdict(lambda: {'files': 0, 'lines': 0})
    total_files = 0
    total_lines = 0

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Modify dirnames in-place to ignore certain directories
        dirnames[:] = [d for d in dirnames if d not in ignore_dirs]

        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext in valid_extensions:
                filepath = os.path.join(dirpath, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = f.readlines()
                        num_lines = len(lines)
                        
                        stats_by_ext[ext]['files'] += 1
                        stats_by_ext[ext]['lines'] += num_lines
                        
                        total_files += 1
                        total_lines += num_lines
                except Exception as e:
                    print(f"Could not read {filepath}: {e}")

    return stats_by_ext, total_files, total_lines

if __name__ == "__main__":
    project_root = "."
    print(f"Calculating code statistics for: {os.path.abspath(project_root)}\n")
    
    stats_by_ext, total_files, total_lines = calculate_code_stats(project_root)
    
    print(f"{'Extension':<15} | {'Files':<10} | {'Lines':<10}")
    print("-" * 43)
    
    # Sort extensions by number of lines descending
    sorted_stats = sorted(stats_by_ext.items(), key=lambda item: item[1]['lines'], reverse=True)
    
    for ext, stats in sorted_stats:
        # Check if ext is empty (files with no extension, though valid_extensions should filter these out)
        display_ext = ext if ext else "No extension"
        print(f"{display_ext:<15} | {stats['files']:<10} | {stats['lines']:<10}")
        
    print("-" * 43)
    print(f"{'Total':<15} | {total_files:<10} | {total_lines:<10}")
    print("-" * 43)
