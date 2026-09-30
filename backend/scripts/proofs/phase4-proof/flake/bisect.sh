#!/usr/bin/env bash
D=/d/PROJECTS/SIH_FELLOWSHIP/.phase4-proof/flake
cd /d/PROJECTS/SIH_FELLOWSHIP/vidyasetu
( while [ ! -f $D/stop2 ]; do docker compose build --no-cache api >> $D/load-build2.log 2>&1; done ) &
node -e "const {Worker}=require('worker_threads');for(let i=0;i<16;i++)new Worker('const fs=require(\"fs\");let x=0;while(!fs.existsSync(\"$D/stop2\")){for(let j=0;j<1e7;j++)x+=j;}',{eval:true});" &
sleep 20; cd api
for group in "src/selection/allocator.spec.ts src/selection/selection-policies.spec.ts" \
             "src/redis/redis.service.spec.ts src/auth/password.spec.ts" \
             "src/prisma/prisma.service.spec.ts src/auth/password.spec.ts" \
             "src/ml-client/ml-client.service.spec.ts src/auth/password.spec.ts" \
             "src/database/actor-transaction.spec.ts src/auth/password.spec.ts"; do
  for i in 1 2 3 4; do
    out=$(npx jest --maxWorkers=2 --colors=false --verbose $group 2>&1)
    echo "$out" >> "$D/bisect-$(basename ${group%% *} .spec.ts).log"
    echo "$(basename ${group%% *}) run$i tests=[$(echo "$out" | grep -E '^Tests:' | sed 's/Tests: *//')] force_exit=$(echo "$out" | grep -c 'failed to exit gracefully')" >> $D/bisect-summary.txt
  done
done
touch $D/stop2; wait; echo done >> $D/bisect-summary.txt
