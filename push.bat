@echo off
cd /d "d:\ZTO\AI\考试\0706\0706kaoshi"
echo === Stage all changes ===
git add -A
echo === Commit ===
git commit -m "feat: switch from Supabase to Neon PostgreSQL; fix TS type errors"
echo === Push to GitHub ===
git push origin master
echo === Done ===
pause
