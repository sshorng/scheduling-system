# 回歸煙霧測試

在專案目錄執行：

```powershell
node tests/smoke.cjs
```

自動排課綁班情境測試：

```powershell
node tests/bind-placement.cjs
```

測試涵蓋 JavaScript／GAS 語法、必要 DOM ID、主頁籤結構、靜態資源版本、凍結課程保護、課表版本指紋、批次寫回硬限制稽核、多教師衝突，以及綁班節數不一致與部分綁班拒絕規則。

自動排課唯讀 dry-run：

```powershell
node tests/auto-schedule-live-dry-run.cjs
```

執行前需設定 `SCHEDULING_TEST_GAS_URL`。自動排課固定禁止同班同科同日重複，只有必排規則明確指定同日連續節次的連堂課可依指定節次通過；此測試會攔截批次寫回，不會修改 GAS 課表。

若要測試亂數差異，可設定 `SCHEDULING_TEST_RANDOMIZE=true` 與 `SCHEDULING_TEST_RANDOM_SEED`。若要測試基準解加兩次候選的多方案探索，再設定 `SCHEDULING_TEST_MULTI_RESTART=true`。

若要展開未排課限制圖診斷，再設定 `SCHEDULING_TEST_INCLUDE_FAILURE_GRAPH=true`；平時不開啟，以免影響排課效能。

若要查看各排課階段耗時，再設定 `SCHEDULING_TEST_PROFILE=true`；搭配 `SCHEDULING_TEST_SUMMARY_ONLY=true` 可只輸出摘要。

若只要輸出種子、未排數、硬限制、綁班、動態失敗事件及後端稽核結果，可設定 `SCHEDULING_TEST_COMPACT=true`。

若要測試排課時間上限，可設定 `SCHEDULING_TEST_TIME_BUDGET_MS`；未設定時，一般排課預設 300 秒，多方案預覽每個候選預設 120 秒。

`SCHEDULING_TEST_TEACHER_CONSEC=false` 僅供 A／B 診斷教師連堂限制的影響，正式排課仍依畫面設定維持嚴格限制。

綁班整組鎖定回歸測試：

```powershell
node tests/bind-lock.cjs
```
