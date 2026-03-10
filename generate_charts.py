import re

with open('charts-all.html', 'r') as f:
    content = f.read()

nav_links = """
    <div style="text-align: center; margin-top: 40px; padding-top: 20px;">
        <p><strong>View Individual Charts:</strong></p>
        <a href="charts-all.html" class="secondary" style="margin: 0 10px;">All Charts</a> |
        <a href="chart-mood.html" class="secondary" style="margin: 0 10px;">Mood</a> |
        <a href="chart-color.html" class="secondary" style="margin: 0 10px;">Color</a> |
        <a href="chart-reaction.html" class="secondary" style="margin: 0 10px;">Reaction</a> |
        <a href="chart-words.html" class="secondary" style="margin: 0 10px;">Words</a>
    </div>
"""

# add nav links before </body>
content = content.replace('</body>', nav_links + '\n</body>')

with open('charts-all.html', 'w') as f:
    f.write(content)

charts = {
    'mood': ('chart-mood.html', 'Mood Chart'),
    'color': ('chart-color.html', 'Color Chart'),
    'reaction': ('chart-reaction.html', 'Reaction Chart'),
    'words': ('chart-words.html', 'Word Cloud')
}

for key, (filename, title) in charts.items():
    page_content = content.replace('All Charts Data Dashboard', title).replace('Live Dashboard', 'Live ' + title)
    
    # remove the grid logic to make it full width
    page_content = page_content.replace('<div class="grid">', '<div>')
    
    # regex to find all chart-containers
    # We will remove containers that don't match the current key
    import re
    
    def replace_container(m):
        if key in m.group(0).lower():
            return m.group(0).replace('height: 350px;', 'height: 60vh;')
        return ''
    
    page_content = re.sub(r'<div class="chart-container">.*?</div>\s*</div>', replace_container, page_content, flags=re.DOTALL)
    
    with open(filename, 'w') as f:
        f.write(page_content)

print("Charts generated!")
