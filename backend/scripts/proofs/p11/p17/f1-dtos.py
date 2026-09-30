"""Phase 17 F1: DTO properties - flags strings without a length / pattern bound, objects / arrays without a size bound."""
import re, glob
ROOT = 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/src/'
flags = []; total = 0
for f in sorted(glob.glob(ROOT + '**/*.ts', recursive=True)):
    if f.endswith('.spec.ts'): continue
    s = open(f, encoding='utf8').read()
    for cm in re.finditer(r"export class (\w+(?:Dto|Query|Body)\w*)\s*(?:extends [\w<>()]+\s*)?\{(.*?)\n\}", s, re.S):
        cls, body = cm.groups()
        # each property: decorators then name[?!]: type;
        for pm in re.finditer(r"((?:\s*@[\w.]+\([^;]*?\)\s*)+)\s*(\w+)[?!]?:\s*([^;]+);", body, re.S):
            decos, name, typ = pm.groups(); total += 1
            d = decos
            bounded = any(k in d for k in ['@Length', '@MaxLength', '@Matches', '@IsIn', '@IsEnum', '@IsUUID', '@IsEmail', '@IsDateString', '@IsISO8601', '@IsInt', '@IsNumber', '@IsBoolean', '@Max(', '@IsNumberString', '@IsDecimal', '@IsBooleanString', '@IsPhoneNumber', '@ArrayMaxSize'])
            if not bounded:
                names = ' '.join(re.findall(r'@[A-Za-z]+', d))
                flags.append(f"{f.replace(ROOT,'src/')} {cls}.{name}: {typ.strip()} | {names}")
print(total, 'DTO properties;', len(flags), 'without an explicit bound:')
for x in flags: print(' ', x)
