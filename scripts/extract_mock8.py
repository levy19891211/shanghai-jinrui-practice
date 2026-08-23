import re, json
from lxml import etree, html as lxml_html

PATH = '/Users/levi/Downloads/TMUA Paper 1 — Mock 8 (Answer Key).html'
raw = open(PATH, encoding='utf-8').read()
tree = lxml_html.fromstring(raw)

def tex_of_mathml(elem):
    ann = elem.xpath('.//annotation[@encoding="application/x-tex"]')
    return (ann[0].text or '').strip() if ann else None

def extract_text(root):
    out = []
    def walk(e):
        if isinstance(e, str):
            out.append(e); return
        if e.tag is etree.Comment:
            return
        cls = e.get('class') or ''
        if 'katex' in cls:
            if 'katex-mathml' in cls:
                t = tex_of_mathml(e)
                if t is not None:
                    out.append('$' + t + '$')
            else:
                # katex 容器（span.katex / katex-html 等）：下钻找 katex-mathml
                mm = e.xpath('.//*[contains(@class,"katex-mathml")]')
                for m in mm:
                    t = tex_of_mathml(m)
                    if t is not None:
                        out.append('$' + t + '$')
            # 保留 katex 之后的 tail 文本（如 " be integers. The number "）
            if e.tail:
                out.append(e.tail)
            return
        if e.text:
            out.append(e.text)
        for c in e:
            walk(c)
        if e.tail:
            out.append(e.tail)
    walk(root)
    s = ''.join(out)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n\s*\n+', '\n', s)
    return s.strip()

lis = tree.xpath('//ol[contains(@class,"q")]/li[contains(@class,"q")]')
print('questions found:', len(lis))

def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()

questions = []
for idx, li in enumerate(lis):
    n = idx + 1
    stem_div = li.xpath('./div[contains(@class,"stem")]')
    ul = li.xpath('./ul[contains(@class,"opts")]')
    ans_div = li.xpath('./div[contains(@class,"ans")]')
    sol_div = li.xpath('./div[contains(@class,"sol")]')
    src_div = li.xpath('./div[contains(@class,"src")]')
    if not (stem_div and ul and ans_div):
        print('Q'+str(n)+' MISSING parts'); continue
    stem = re.sub(r'^Q\d+\.\s*', '', extract_text(stem_div[0]))
    opts = []
    for li2 in ul[0].xpath('./li'):
        t = re.sub(r'^[A-Ha-h]\.\s*', '', extract_text(li2))
        opts.append(t)
    ans_text = extract_text(ans_div[0])
    ans_value = re.sub(r'^Answer:\s*', '', ans_text, flags=re.I).strip()
    answer = None
    for o in opts:
        if norm(o) == norm(ans_value):
            answer = o; break
    if answer is None:
        m = re.match(r'^([A-Ea-e])\b', ans_value)
        if m:
            oi = 'ABCDE'.index(m.group(1).upper())
            if opts[oi]:
                answer = opts[oi]
    if answer is None:
        print('Q'+str(n)+' WARN ans not matched:', repr(ans_value))
        answer = ans_value
    sol = ''
    if sol_div:
        sol = re.sub(r'^Solution\.\s*', '', extract_text(sol_div[0]), flags=re.I)
    diff = 3
    src_note = ''
    if src_div:
        src_note = (src_div[0].text or '').strip()
        dm = re.search(r'Difficulty\s+(\d+)', src_note, re.I)
        if dm:
            diff = int(dm.group(1))
    questions.append({
        'subject':'数学','paper':'P1','topic':'M1','topicIds':['M1'],
        'difficulty':diff,'type':'SINGLE_CHOICE','status':'PUBLISHED',
        'source':'TMUA-P1-MOCK8-Q'+str(n),'sourceType':'TMUA',
        'stem':stem,'options':opts,'answer':answer,'solution':sol,'srcNote':src_note,
    })
    print('Q'+str(n),'opts='+str(len(opts)),'ans='+repr(answer[:40]),'diff='+str(diff))

paper = {
    'title':'TMUA Paper1 模考8','subject':'数学','sourceType':'TMUA',
    'source':'TMUA-P1-MOCK8','origin':'AUTO_SET','kind':'mock','status':'READY',
    'sourceKey':'数学::P1::TMUA-P1-MOCK8',
    'questionIds':['__Q'+str(i)+'__' for i in range(len(questions))],
}
json.dump({'paper':paper,'questions':questions},
          open('scripts/bank_tmua_p1_mock8.json','w',encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('WROTE scripts/bank_tmua_p1_mock8.json with', len(questions), 'questions')
