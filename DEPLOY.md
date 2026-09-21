# 社内サーバーへのデプロイ手順（Windows 10、タスクスケジューラ）

Next.js本体（`web/`）とCP-SATサイドカー（`sidecar/`）を、それぞれ独立した
Windows標準の「タスクスケジューラ」のタスクとして常駐化する（追加ソフト不要）。この手順は開発機ではなく**実際に配置する
Windows 10サーバー上**で実行する。

## 0. 前提

- サーバーがローカルネットワーク内のみで、インターネットには公開しない構成
- Docker不使用（タスクスケジューラで直接プロセスを常駐化。NSSM等の追加ソフトは不要）
- コードとデータを別ディレクトリに分ける（コードを再配置してもデータは残る）
  - コード配置先の例: `C:\ShiftApp\web`, `C:\ShiftApp\sidecar`
  - データ保存先の例: `C:\ShiftAppData`（DBファイル・バックアップ）

## 1. 事前インストール（サーバー側）

1. **Node.js**（推奨: LTS版）をインストール
2. **Python 3.11以降**をインストール（`pip`込み）

## 2. コードの配置

このリポジトリの `web/` と `sidecar/` を、サーバー上の配置先ディレクトリに
コピーする（`node_modules/`・`.venv/`・`.next/`・`dev.db` はコピー不要、
次のステップでサーバー上に作り直す）。

## 3. Next.js本体（web/）のセットアップ

配置先の `web/` ディレクトリで実行:

```powershell
npm install               # 完了時に postinstall で Prisma クライアント(src/generated/)が自動生成される
npx prisma migrate deploy   # DBスキーマを作成（この時点で dev.db が生成される）
npx tsx prisma/seed.ts      # 初期シフト種別・フロア設定を投入
npm run build               # .next/standalone/ が生成される

# standaloneモードは static/public を自動で含めないため手動コピーが必要
Copy-Item -Recurse .next\static .next\standalone\.next\static
Copy-Item -Recurse public .next\standalone\public
```

生成された `dev.db` を、データ保存先ディレクトリ（例: `C:\ShiftAppData\dev.db`）に
移動しておく（`install-service.ps1` がこのパスを `DATABASE_URL` として使う）。

**旧アプリからの実データ移行**: `/import`機能は削除済み。移行が必要な場合は
`web/src/server/actions/schedule.ts` 等が参照していた旧ロジック（このリポジトリの
コミット履歴、`fee5264`〜`cd953b1` 付近）を一時的に復元して使うか、スタッフ登録
画面から手入力する。

### タスク登録

**PowerShellを「管理者として実行」で開いて**実行する:

```powershell
cd web/scripts
./install-service.ps1 -DeployDir "C:\ShiftApp\web\.next\standalone" -DataDir "C:\ShiftAppData" -AdminPassword "実際に使うパスワード"
```

`-AdminPassword` は必須。`/dashboard`（当日ダッシュボード）以外の全ページで、この
パスワードでのログインが必要になる（個人アカウントではなく共通パスワード1つ）。

これで:
- Node.jsサーバーがタスク「ShiftWebApp」として、サーバー起動時（ログイン不要）に自動起動
- クラッシュ時は起動用スクリプト（`C:\ShiftAppData\run-shift-web.cmd`）内のループで10秒後に自動再起動
- ポート3000でLISTEN（`-Port`で変更可）、`HOSTNAME=0.0.0.0` でLAN内の他端末からもアクセス可能
- ログは `C:\ShiftAppData\web-service.log` / `web-service-error.log`（10MB超で世代交代）

として登録される。`run-shift-web.cmd` には共通パスワードが書かれるため、
管理者・SYSTEM以外は読めないアクセス権に自動設定される。

**ファイアウォール**（スクリプト実行後、表示される案内の通り）:

```powershell
New-NetFirewallRule -DisplayName "Shift Web App" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

## 4. CP-SATサイドカー（sidecar/）のセットアップ

配置先の `sidecar/` ディレクトリで実行:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### タスク登録

**PowerShellを「管理者として実行」で開いて**実行する:

```powershell
cd sidecar/scripts
./install-service.ps1 -DeployDir "C:\ShiftApp\sidecar"
```

`127.0.0.1:8001` のみでLISTENする（LANには一切公開しない設計・ファイアウォール
設定も不要）。Next.js側の `SIDECAR_URL` 環境変数（`install-service.ps1`実行時に
自動設定済み）経由でのみ呼び出される。サイドカーが落ちていてもNext.js側は
自動的にそのパターンをスキップするだけなので、Web本体は動き続ける。

## 5. 動作確認

1. サーバー自身で `http://localhost:3000` を開き、シフト表・自動生成まで一通り操作
2. 同じLAN内の別端末から `http://<サーバーのIP>:3000` にアクセスできることを確認
3. サーバーを再起動し、手動操作なしで両サービスが自動的に立ち上がることを確認
4. サイドバーの「今すぐバックアップ」を押し、`C:\ShiftAppData\backups\` に
   ファイルが作成されることを確認

## 6. 運用メモ

- **自動バックアップ**: サーバー起動時＋以後6時間ごとに自動実行、直近30世代を
  `C:\ShiftAppData\backups\` に保持（`web/src/instrumentation.ts`）。
  このフォルダは同じサーバー内なので、本当に重要なら別ドライブ・NAS等への
  定期コピーも検討する（未実装、運用課題として残っている）。
- **コード更新時**: 新しいコードを配置 → `npm install` → `npm run build` →
  static/public再コピー → `install-service.ps1` を再実行（古いプロセスを停止して
  タスクを登録し直す）。DBファイルは
  データ保存先ディレクトリにあるため、コード更新の影響を受けない。
- **状態確認・手動操作**: `Get-ScheduledTask ShiftWebApp, ShiftCpSatSidecar`、または
  「タスクスケジューラ」アプリから確認・実行できる。**タスクを止めても子の `node.exe` /
  `python.exe` は残る**ので、止めたいときは `uninstall-service.ps1`（タスク削除＋プロセス停止）を使う。
- **アンインストール**: `web/scripts/uninstall-service.ps1 -DeployDir <配置先>` /
  `sidecar/scripts/uninstall-service.ps1`（いずれも管理者権限）。
