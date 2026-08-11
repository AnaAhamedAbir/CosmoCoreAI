import os

# যে ডিরেক্টরিগুলো বাদ দেওয়া হবে
EXCLUDE_DIRS = {
    'node_modules',
    '.git',
    'venv',
    '.venv',
    '__pycache__',
    'dist',
    'build',
    '.next',
    'artifacts'
}

# যে ফাইল টাইপগুলো গোনা হবে
INCLUDE_EXTENSIONS = {
    '.py', '.ts', '.tsx', '.js', '.jsx', 
    '.css', '.scss', '.html', '.json', '.md'
}

def count_lines(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return len(f.readlines())
    except Exception:
        return 0

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    stats = {}
    total_lines = 0
    total_files = 0

    print(f"\n--- Scanning Project: {os.path.basename(root_dir)} ---\n")

    for root, dirs, files in os.walk(root_dir):
        # বাদ দেওয়ার ডিরেক্টরিগুলো ফিল্টার করা
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in INCLUDE_EXTENSIONS:
                file_path = os.path.join(root, file)
                lines = count_lines(file_path)
                
                stats[ext] = stats.get(ext, 0) + lines
                total_lines += lines
                total_files += 1

    # রেজাল্ট প্রিন্ট করা
    print(f"{'Extension':<12} | {'Lines of Code':<15}")
    print("-" * 30)
    
    # সর্টিং করে দেখানো (বেশি লাইন থেকে কম লাইন)
    sorted_stats = sorted(stats.items(), key=lambda x: x[1], reverse=True)
    
    for ext, lines in sorted_stats:
        print(f"{ext:<12} | {lines:<15,}")

    print("-" * 30)
    print(f"{'TOTAL':<12} | {total_lines:<15,}")
    print(f"\nTotal Files Scanned: {total_files}")

if __name__ == "__main__":
    main()
