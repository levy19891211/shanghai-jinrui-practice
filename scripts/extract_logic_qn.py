import re, json
from lxml import etree, html as lxml_html

PATH = '/Users/levi/Downloads/TMUA P1 逻辑专练 · 量词否定 20 题（加量·纯净版）.html'
raw = open(PATH, encoding='utf-8').read()
tree = lxml_html.fromstring(raw)

def text_of(e):
    t = ''.join(e.itertext())
    t = re.sub(r'\s+', ' ', t).strip()
    return t

qs_blocks = tree.xpath('//div[contains(@class,"q") and @id]')
print('question blocks:', len(qs_blocks))

def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()

questions = []
for li in qs_blocks:
    qid = li.get('id')  # Q1..Q20
    n = int(re.search(r'\d+', qid).group())
    ttl = li.xpath('.//div[contains(@class,"q-head")]//span[contains(@class,"ttl")]')
    stem = li.xpath('.//div[contains(@class,"stem")]')
    ttl_txt = text_of(ttl[0]) if ttl else ''
    stem_txt = text_of(stem[0]) if stem else ''
    full_stem = (ttl_txt + '\n\n' + stem_txt).strip() if ttl_txt else stem_txt

    opt_lis = li.xpath('.//ol[contains(@class,"opts")]/li')
    opts = []
    opt_map = {}
    for o in opt_lis:
        lab = o.xpath('.//span[contains(@class,"lab")]/text()')
        ot = o.xpath('.//span[contains(@class,"ot")]')
        letter = (lab[0] if lab else '').strip()
        content = text_of(ot[0]) if ot else ''
        opts.append(content)
        opt_map[letter] = content

    # 答案
    ans_h = li.xpath('.//div[contains(@class,"sol-h") and contains(text(),"Answer")]')
    ans_letter = ''
    if ans_h:
        m = re.search(r'Answer:\s*([A-H])', ans_h[0].text or '')
        if m:
            ans_letter = m.group(1)
    answer = opt_map.get(ans_letter, '')

    # 解析：直接取 sol-body 全部文本（含 Solution 正文 + distractor 说明），再去掉孤立标题词
    sol_body = li.xpath('.//div[contains(@class,"sol-body")]')
    solution = ''
    if sol_body:
        sb = sol_body[0]
        raw = ''.join(sb.itertext())
        raw = re.sub(r'\s+', ' ', raw).strip()
        # 去掉开头的 "Solution" 孤立标题（其后正文直接跟在后面，无分隔）
        raw = re.sub(r'^Solution(\S)', r'Solution: \1', raw)
        raw = re.sub(r'\s*Why the distractors fail\s*', '\n\nWhy the distractors fail\n', raw)
        solution = raw

    diff = 4
    src_note = 'TMUA P1 逻辑专练·量词否定'

    questions.append({
        'subject':'数学','paper':'P1','topic':'Logic','topicIds':['Logic'],
        'difficulty':diff,'type':'SINGLE_CHOICE','status':'PUBLISHED',
        'source':'TMUA-P1-LOGIC-QN-Q'+str(n),'sourceType':'TMUA',
        'stem':full_stem,'options':opts,'answer':answer,'solution':solution,'srcNote':src_note,
    })
    print('Q'+str(n),'opts='+str(len(opts)),'ans='+ans_letter,'sol_len='+str(len(solution)))

paper = {
    'title':'TMUA P1 逻辑专练·量词否定 20 题','subject':'数学','sourceType':'TMUA',
    'source':'TMUA-P1-LOGIC-QN','origin':'AUTO_SET','kind':'mock','status':'READY',
    'sourceKey':'数学::P1::TMUA-P1-LOGIC-QN',
    'questionIds':['__Q'+str(i)+'__' for i in range(len(questions))],
}
json.dump({'paper':paper,'questions':questions},
          open('scripts/bank_tmua_p1_logic_qn.json','w',encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('WROTE scripts/bank_tmua_p1_logic_qn.json with', len(questions), 'questions')
