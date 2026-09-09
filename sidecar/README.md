# シフト最適化サイドカー（CP-SAT）

Next.js本体（`../web`）から呼び出される、Google OR-Tools（CP-SAT）による
シフト自動生成の最適化サービス。単体で動く別プロセス（別言語）として実装している。

## 役割分担

- **このサイドカーが解くもの**: 「誰が・いつ・どのシフト種別か」だけ。ハード制約
  （夜勤→明けの強制、連勤上限、週・月出勤上限、夜勤専従の扱い、NGペア等）を
  CP-SATの制約として厳密に課し、必要人数の充足・公休目標・ペア推奨・夜勤の
  均等化はソフト制約（目的関数のペナルティ／ボーナス）として最適化する。
- **解かないもの**: 業務（LD・入浴・排泄・フロア）の割当。ここはNext.js側の
  既存 `assignDuties()`（`web/src/domain/scheduler.ts`、テスト済み）を
  ソルバーの出力に対して後段実行する。ロジックの二重実装を避けるため。

## セットアップ

```bash
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # Windows
# ./.venv/bin/pip install -r requirements.txt      # Linux/macOS
```

## 起動（開発時）

```bash
./.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

`127.0.0.1` のみでLISTENする（社内LANはもちろん、同一マシンの他プロセス以外からは
到達できない）。本番運用時はNSSMでWindowsサービス化する想定（Next.js側と同様）。

Next.js側は環境変数 `SIDECAR_URL`（デフォルト `http://127.0.0.1:8001`）でこの
サービスのURLを解決する（`web/.env` 参照）。サイドカーが未起動・タイムアウトの
場合は黙ってスキップされ、通常のNode内蔵エンジン（貪欲法+焼きなまし法）の
パターンのみが表示される（サイドカーは必須コンポーネントではない）。

## テスト

```bash
./.venv/Scripts/python -m pytest tests/ -v
```

`tests/test_solver.py` は `web/src/domain/scheduler.test.ts` のハード制約テストを
このソルバー向けに移植したもの。`tests/test_api.py` はFastAPIエンドポイントの
レベルでの疎通確認。
