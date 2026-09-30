"""Phase 17 F1: inventory of every route - method, path, roles, how params / query / body are validated,
rate limit. Usage: python f1-routes.py <out.json> [<out.md>]"""
import json
import re
import sys
import glob

ROOT = 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/src/'
ROUTE = re.compile(
    r"@(Get|Post|Patch|Put|Delete)\(((?:[^()]|\([^)]*\))*)\)(.*?)\n  (?:async )?(\w+)\(([^{]*?)\)(?::[^{]*)?\s*\{",
    re.S,
)
rows = []
for f in sorted(glob.glob(ROOT + '**/*.ts', recursive=True)):
    if f.endswith('.spec.ts'):
        continue
    s = open(f, encoding='utf8').read()
    for cm in re.finditer(r"@Controller\('([^']*)'\)\s*export class (\w+)", s):
        prefix, cls = cm.group(1), cm.group(2)
        class_public = '@Public()' in s[max(0, cm.start() - 300):cm.start()]
        start = cm.end()
        nxt = s.find('@Controller(', start)
        body = s[start: nxt if nxt > 0 else len(s)]
        for m in ROUTE.finditer(body):
            verb, arg, decos, name, params = m.groups()
            sub = arg.strip().strip("'`") if arg.strip() else ''
            path = '/' + '/'.join(x for x in [prefix, sub] if x)
            roles = re.search(r"@Roles\(([^)]*)\)", decos)
            scheme_admin = re.search(r"@SchemeAdmin\('(\w+)'\)", decos)
            if '@Public()' in decos or class_public:
                who = 'PUBLIC'
            elif roles:
                who = roles.group(1).replace('AppRole.', '').replace('...', '')
            elif scheme_admin:
                who = f"SCHEME_{scheme_admin.group(1).upper()}_ROLES (config)"
            else:
                who = 'NONE (fails closed)'
            rl = re.search(r"@RateLimit\('(\w+)'\)", decos)
            thr = re.search(r"@Throttle\(([^)]*\)?)\)", decos)
            p_params = re.findall(r"@Param\('(\w+)'(,\s*(?:new )?\w+(?:\([^)]*\))?)?\)", params)
            param_desc = []
            for pn, pipe in p_params:
                pipe = pipe or ''
                kind = 'uuid' if ('ParseUUIDPipe' in pipe or 'uuid' in pipe) else ('int' if 'ParseIntPipe' in pipe else ('pipe' if pipe else 'string'))
                param_desc.append(f'{pn}:{kind}')
            body_dto = re.search(r"@Body\(\)\s*\w+:\s*([\w<>\[\], ]+)", params)
            q_dto = re.search(r"@Query\(\)\s*\w+:\s*([\w<>\[\], ]+)", params)
            q_raw = re.findall(r"@Query\('(\w+)'", params)
            rows.append(dict(
                verb=verb.upper(), path=path, file=f.replace(ROOT, 'src/').replace('\\', '/'), roles=who,
                params=', '.join(param_desc) or '-',
                body=(body_dto.group(1).strip().rstrip(',') if body_dto else '-'),
                query=(q_dto.group(1).strip().rstrip(',') if q_dto else (', '.join('raw:' + x for x in q_raw) if q_raw else '-')),
                upload=('@UploadedFile' in params or 'FileInterceptor' in decos),
                limit=(rl.group(1) if rl else ('login throttle' if thr and 'AUTH_THROTTLE' in thr.group(1) else ('throttle ' + thr.group(1) if thr else '-'))),
            ))
json.dump(rows, open(sys.argv[1], 'w'), indent=1)
print(len(rows), 'routes;', sum(1 for r in rows if r['roles'].startswith('NONE')), 'without a role policy;',
      sum(1 for r in rows if r['roles'] == 'PUBLIC'), 'public')
string_params = [r for r in rows if ':string' in r['params']]
print('string path params (validated in code, see the review):', len(string_params))
for r in string_params:
    print(' ', r['verb'], r['path'], '|', r['params'])
if len(sys.argv) > 2:
    lines = ['| Method | Path | Roles | Path params | Query | Body | Rate limit |', '|---|---|---|---|---|---|---|']
    for r in sorted(rows, key=lambda r: (r['path'], r['verb'])):
        body = r['body'] + (' + file' if r['upload'] else '')
        lines.append(f"| {r['verb']} | `{r['path']}` | {r['roles']} | {r['params']} | {r['query']} | {body} | {r['limit']} |")
    open(sys.argv[2], 'w', encoding='utf8').write('\n'.join(lines) + '\n')
