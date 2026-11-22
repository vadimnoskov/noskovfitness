"""Extract normalized movement phrases from BTWB exports. Usage: python3 -I extract_movements.py out.tsv file1.csv [file2.csv ...]"""
import csv, re, sys, collections as C
SKIP=re.compile(r'(round|rounds|rest|for time|amrap|amreps|then|every|minute|interval|sets? of|^sets|tabata|emom|on the|each|max |reps? of|^\*|^-|post |complete|as many|time cap|cap|prior to|in remaining|for total|alternating between|partner)',re.I)
def norm(line):
    l=line.strip()
    if not l or SKIP.search(l): return None
    l=l.split('|')[0]
    l=re.sub(r'^[\d.,/\-]+\s*(x\s*)?','',l)                       # leading count
    l=re.sub(r'^(m|km|mi|cal|cals|calories|ft|yd|yds|meters?|secs?|mins?)\b\s*','',l,flags=re.I)
    l=re.sub(r',?\s*\d+(\.\d+)?(/\d+(\.\d+)?)?\s*(lbs?|kg|pood|in|inch(es)?|ft|"|#|%|x bodyweight).*$','',l,flags=re.I)
    l=re.sub(r',\s*(\d+% 1RM|[\d.]+x bodyweight|bodyweight).*$','',l,flags=re.I)
    l=re.sub(r'\s+\d.*$','',l)
    l=re.sub(r'[^A-Za-z0-9&\-\s()\'/]','',l).strip(' -')
    l=re.sub(r'\s+',' ',l).lower()
    l=re.sub(r'\(([^)]*)\)s$',r'(\1)',l)
    if len(l)<3: return None
    return l
out=sys.argv[1]; cnt=C.Counter(); ex={}
for f in sys.argv[2:]:
    for r in csv.DictReader(open(f,encoding='utf-8')):
        for line in r['Description'].split('\n'):
            n=norm(line)
            if n: cnt[n]+=1; ex.setdefault(n,line.strip()[:80])
with open(out,'w') as o:
    for k,v in cnt.most_common(): o.write(f'{v}\t{k}\t{ex[k]}\n')
print('distinct',len(cnt),'occurrences',sum(cnt.values()))
