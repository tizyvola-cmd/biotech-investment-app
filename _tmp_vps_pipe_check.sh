#!/bin/bash
grep -oE "assets/index-[^\"]+" /opt/biotech/desktop-ui/dist/index.html
grep -o "Approvati / sul mercato\|MoA / target\|mechanism_of_action" /opt/biotech/desktop-ui/dist/assets/index-*.js | sort | uniq -c | head
python3 -c "import product_briefing_lookup as p; print('pipeline_schema', p._PIPELINE_SCHEMA)"