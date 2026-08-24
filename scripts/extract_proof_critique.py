import re, json
from lxml import html as lxml_html

PATH = '/Users/levi/Downloads/TMUA 论证评估专练20 题A.html'
raw = open(PATH, encoding='utf-8').read()
tree = lxml_html.fromstring(raw)

def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()

qs_blocks = tree.xpath('//div[contains(@class,"q") and @id]')
print('question blocks:', len(qs_blocks))

questions = []
for li in qs_blocks:
    qid = li.get('id')  # Q1..Q20
    n = int(re.search(r'\d+', qid).group())

    # 题干: .stem 内全部文本(Problem + A student attempts + steps + qask)
    stem_el = li.xpath('.//div[contains(@class,"stem")]')
    stem_txt = norm(''.join(stem_el[0].itertext())) if stem_el else ''

    # 选项 A-H (li[data-opt])
    opt_lis = li.xpath('.//ol[contains(@class,"opts")]/li[@data-opt]')
    opts = []
    opt_map = {}
    for o in opt_lis:
        letter = o.get('data-opt')
        content = norm(''.join(o.itertext()))
        opts.append(content)
        opt_map[letter] = content

    if len(opts) != 8:
        print('  !! Q'+str(n)+' option count =', len(opts))

    # 答案: .exp 中 "选 X" 标记; 缺失时回退到 "首错在 line L" -> 含 "first error ... in line L" 的选项
    exp_els = li.xpath('.//div[contains(@class,"exp")]')
    exp_txt = norm(''.join(exp_els[0].itertext())) if exp_els else ''
    ans_letter = ''
    m = re.search(r'选\s*([A-H])', exp_txt)
    if m:
        ans_letter = m.group(1)
    else:
        ml = re.search(r'首错在\s*line\s*([IVX]+)', exp_txt)
        if ml:
            L = ml.group(1)
            hits = [letter for letter, txt in opt_map.items()
                    if re.search(r'first error (?:occurs|is) in line\s*'+L+r'\b', txt, re.I)]
            if len(hits) == 1:
                ans_letter = hits[0]
            elif len(hits) > 1:
                print('  !! Q'+str(n)+' multiple line-'+L+' options:', hits)
            else:
                print('  !! Q'+str(n)+' no option matches line '+L)
    answer = opt_map.get(ans_letter, '')
    if not answer:
        print('  !! Q'+str(n)+' answer letter', ans_letter, 'not found in opts')

    solution = exp_txt

    questions.append({
        'subject':'数学','paper':'P1','topic':'Logic','topicIds':['Logic'],
        'difficulty':4,'type':'SINGLE_CHOICE','status':'PUBLISHED',
        'source':'TMUA-P1-PROOF-CRITIQUE-Q'+str(n),'sourceType':'TMUA',
        'stem':stem_txt,'options':opts,'answer':answer,'solution':solution,
        'srcNote':'TMUA P1 论证评估(Proof-Critique)专练',
    })
    print('Q'+str(n), 'opts='+str(len(opts)), 'ans='+ans_letter, 'sol_len='+str(len(solution)))

paper = {
    'title':'TMUA P1 论证评估专练 20 题 A','subject':'数学','sourceType':'TMUA',
    'source':'TMUA-P1-PROOF-CRITIQUE','origin':'AUTO_SET','kind':'mock','status':'READY',
    'sourceKey':'数学::P1::TMUA-P1-PROOF-CRITIQUE',
    'questionIds':['__Q'+str(i)+'__' for i in range(len(questions))],
}
json.dump({'paper':paper,'questions':questions},
          open('scripts/bank_tmua_p1_proof_critique.json','w',encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('WROTE scripts/bank_tmua_p1_proof_critique.json with', len(questions), 'questions')
