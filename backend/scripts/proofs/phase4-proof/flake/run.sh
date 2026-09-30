#!/usr/bin/env bash
D=/d/PROJECTS/SIH_FELLOWSHIP/.phase4-proof/flake
cd /d/PROJECTS/SIH_FELLOWSHIP/vidyasetu
# Load 1: repeated no-cache image builds (the condition present during the earlier failure)
( while [ ! -f $D/stop ]; do docker compose build --no-cache api >> $D/load-build.log 2>&1; done ) &
BUILD=$!
# Load 2: 16 CPU burners (machine has 20 logical CPUs)
node -e "
const { Worker } = require('worker_threads');
for (let i = 0; i < 16; i++) new Worker('let x=0; const s=Date.now(); while(!require(\"fs\").existsSync(process.argv[1]||\"\")) { for(let j=0;j<1e7;j++) x+=j; }', { eval: true, argv: ['$D/stop'] });
" &
BURN=$!
sleep 20  # let the load ramp up before the first run
cd api
for i in $(seq 1 10); do
  start=$(date +%s)
  echo "=== RUN $i start $(date -u +%H:%M:%S) loadavg-proxy: $(tasklist 2>/dev/null | grep -c node) node procs" > $D/run-$i.log
  npx jest --verbose --colors=false >> $D/run-$i.log 2>&1
  code=$?
  echo "=== RUN $i exit=$code duration=$(( $(date +%s) - start ))s" >> $D/run-$i.log
  echo "run $i exit=$code $(( $(date +%s) - start ))s" >> $D/summary.txt
done
touch $D/stop
wait $BUILD 2>/dev/null; kill $BURN 2>/dev/null
echo done >> $D/summary.txt
