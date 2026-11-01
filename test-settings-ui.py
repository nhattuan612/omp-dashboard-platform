"""Run: python3 test-settings-ui.py (stdlib only)."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import subprocess


class SettingsParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.ids = []
        self.tabs = []
        self.script = None
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id') == 'settingsModal':
            self.depth = 1
        elif self.depth and tag == 'div':
            self.depth += 1
        if self.depth:
            if attrs.get('id'):
                self.ids.append(attrs['id'])
            if 'settings-nav-btn' in attrs.get('class', '').split():
                self.tabs.append(attrs.get('data-tab'))
        if tag == 'script' and 'src' not in attrs:
            self.script = ''

    def handle_endtag(self, tag):
        if self.depth and tag == 'div':
            self.depth -= 1
        if tag == 'script' and self.script is not None:
            self.scripts.append(self.script)
            self.script = None

    def handle_data(self, data):
        if self.script is not None:
            self.script += data


root = Path(__file__).resolve().parent
name = 'honpi-chat-dashboard-SKE.html'
for prefix in ['', 'product-release']:
    parser = SettingsParser()
    html = (root / prefix / name).read_text()
    parser.feed(html)
    assert '@media (prefers-reduced-motion: reduce)' in html
    assert 'transition-duration: .01ms !important' in html
    counts = Counter(parser.ids)
    assert not [key for key, count in counts.items() if count > 1], counts
    assert parser.tabs == ['general', 'models', 'omp', 'agents', 'welcome', 'agent-config'], parser.tabs
    for key in ['canvasToneCurrentBadge', 'fontFamilyCurrentBadge', 'fontSizeIncBtn',
                'fontSizeDecBtn', 'fontSizeDisplay', 'settingsConvDisplaySelect',
                'settingsEnterBehaviorSelect', 'settingsOmpBrowserModeSelect',
                'settingsOmpShareModeSelect', 'ompMemoryStatus', 'ompAgentHubStatus',
                'ompAgentInstructionsTextarea', 'btnSaveAgentInstructions']:
        assert counts[key] == 1, key
    assert not {'settingsTabPlugins', 'ompBrowserModeSelect', 'ompShareModeSelect'} & counts.keys()
    for script in parser.scripts:
        subprocess.run(['node', '--check', '--input-type=commonjs'], input=script, text=True, check=True)
print('Settings source/release: unique IDs, 6 tabs, canonical runtime hosts, inline scripts OK')
