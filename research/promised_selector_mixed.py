#!/usr/bin/env python3
import itertools, json

M=3
G=2*M
NIN=2*M+1
names=[f'd{i}' for i in range(M)]+[f'x{i}' for i in range(M)]+['y']

class CNF:
    def __init__(self): self.n=0; self.cs=[]; self.names={}
    def var(self,name):
        self.n+=1; self.names[self.n]=name; return self.n
    def add(self,*ls):
        out=[]; seen=set()
        for l in ls:
            if -l in seen: return
            if l not in seen: seen.add(l); out.append(l)
        self.cs.append(out)
    def one(self,vs,p):
        self.add(*vs)
        if len(vs)<=1:return
        s=[self.var(f'{p}.s{i}') for i in range(len(vs)-1)]
        self.add(-vs[0],s[0])
        for i in range(1,len(vs)-1):
            self.add(-vs[i],s[i]); self.add(-s[i-1],s[i]); self.add(-vs[i],-s[i-1])
        self.add(-vs[-1],-s[-1])
    def cand(self,z,o,a,b):
        # a,b are either Boolean constants or signed DIMACS literals.
        if isinstance(a,bool) and isinstance(b,bool): self.add(-z,o if a and b else -o); return
        if isinstance(a,bool):
            if not a:self.add(-z,-o);return
            self.add(-z,-o,b);self.add(-z,o,-b);return
        if isinstance(b,bool):
            if not b:self.add(-z,-o);return
            self.add(-z,-o,a);self.add(-z,o,-a);return
        self.add(-z,-o,a);self.add(-z,-o,b);self.add(-z,o,-a,-b)

controls=[]
controls.append(((0,)*M,0));controls.append(((0,)*M,1))
for i in range(M):
    d=[0]*M;d[i]=1;controls.append((tuple(d),0))
assign=[]; idx={}; target=[]
for d,y in controls:
    for xs in itertools.product((0,1),repeat=M):
        a=tuple(d)+tuple(xs)+(y,);idx[a]=len(assign);assign.append(a)
        target.append(int(y or any(d[i] and xs[i] for i in range(M))))

C=CNF(); sels=[]; pairs=[]; vals=[]
def sval(src,ai):
    node,neg=src
    if node<NIN:return bool(assign[ai][node])^neg
    v=vals[node-NIN][ai];return -v if neg else v

for g in range(G):
    ps=[]
    for u in range(NIN+g):
      for v in range(u+1,NIN+g):
       for su in (0,1):
        for sv in (0,1):ps.append(((u,su),(v,sv)))
    zs=[C.var(f'g{g}.p{j}') for j in range(len(ps))];C.one(zs,f'g{g}.one')
    q=[C.var(f'g{g}.a{ai}') for ai in range(len(assign))]
    sels.append(zs);pairs.append(ps);vals.append(q)
    for z,(u,v) in zip(zs,ps):
        for ai in range(len(assign)):C.cand(z,q[ai],sval(u,ai),sval(v,ai))

# Every non-output gate is used later, so a mixed witness cannot be dead.
for g in range(G-1):
    node=NIN+g; uses=[]
    for h in range(g+1,G):
        for z,(u,v) in zip(sels[h],pairs[h]):
            if u[0]==node or v[0]==node:uses.append(z)
    C.add(*uses)

outneg=C.var('out.neg')
for ai,want in enumerate(target):
    q=vals[-1][ai]
    if want==0:C.add(-q,-outneg);C.add(q,outneg)
    else:C.add(-q,outneg);C.add(q,-outneg)

witness=[]; wmeta={}
for g in range(G):
 for i in range(M):
  for j in range(i+1,M):
   others=[q for q in range(M) if q not in (i,j)]
   for d,y in controls:
    for ov in itertools.product((0,1),repeat=len(others)):
     xs=[0]*M
     for q,b in zip(others,ov):xs[q]=b
     ais=[]
     for bi,bj in ((0,0),(0,1),(1,0),(1,1)):
      xx=xs[:];xx[i]=bi;xx[j]=bj;ais.append(idx[tuple(d)+tuple(xx)+(y,)])
     w=C.var(f'w.g{g}.x{i}x{j}.d{"".join(map(str,d))}.y{y}.o{"".join(map(str,ov))}')
     witness.append(w);wmeta[str(w)]={'gate':g,'pair':[i,j],'d':d,'y':y,'other':ov,'ais':ais}
     qs=[vals[g][a] for a in ais]
     for pat in itertools.product((0,1),repeat=4):
      if sum(pat)%2==0:C.add(-w,*[(q if b==0 else -q) for q,b in zip(qs,pat)])
C.add(*witness)

with open('promised_selector_m3_mixed.cnf','w') as f:
    f.write(f'p cnf {C.n} {len(C.cs)}\n')
    for c in C.cs:f.write(' '.join(map(str,c))+' 0\n')
json.dump({'m':M,'gates':G,'variables':C.n,'clauses':len(C.cs),'assignments':assign,'target':target,'names':C.names,'pairs':pairs,'selectors':sels,'outneg':outneg,'witness_meta':wmeta},open('promised_selector_m3_map.json','w'),indent=2)
print(json.dumps({'variables':C.n,'clauses':len(C.cs),'assignments':len(assign),'witnesses':len(witness)}))
