// =====================================================================================================================
// AutowareGraphStudio - 見た目パラメータ集約ファイル
// ---------------------------------------------------------------------------------------------------------------------
// このファイルは「画面の見た目を決める値」を集めた場所です。
// 色、文字サイズ、余白、角丸、影、ノードサイズ、エッジ太さ、矢印サイズなどはここを見れば分かるようにします。
//
// ルール:
// - 画面の見た目を変えたいときは、まずこのファイルを探してください。
// - 各値の右側には必ず日本語コメントを書き、「どこに効く値か」が分かるようにします。
// - px の値は number で持ち、Emotion 側では src/styles/theme.ts の px() で "12px" に変換します。
// - Canvas / React Flow の world unit として使う値も number で持ちます。
// =====================================================================================================================


// =====================================================================================================================
// 1. ベースカラー
// ---------------------------------------------------------------------------------------------------------------------
// アプリ全体で一番よく使う背景・罫線・文字色です。
// =====================================================================================================================

export const bgBase           = "#ffffff";  // アプリ全体の基準背景色。body / :root の背景として使う白
export const bgSubtle         = "#f6f7f9";  // グラフ領域やアプリ外周など、少しだけ沈ませたい背景色
export const bgElevated       = "#ffffff";  // ツールバー、パネル、ノードカード、入力欄など前面にある面の背景色
export const bgHover          = "#f1f3f6";  // 通常ボタンや透明ボタンをホバーしたときの背景色
export const bgActive         = "#e9ebef";  // ボタンを押している瞬間、または押下状態を表す背景色
export const bgInset          = "#fafbfc";  // ノードタイトル帯、リスト内側、入力グループなど内側に凹んだ面の背景色

export const borderSubtle     = "#eceef1";  // セクション区切り、ツールバー下線、薄いカード枠などの最も弱い罫線色
export const borderDefault    = "#53749d";  // 入力欄、通常ボタン、通常ノードなどの標準枠線色
export const borderStrong     = "#b8bdc4";  // ボタンホバー、強調したい境界などの少し強い枠線色

export const textPrimary      = "#0f172a";  // 見出し、本文、ノード名など最も重要な文字色
export const textSecondary    = "#475569";  // メタ情報、補助説明、通常より少し弱い本文の文字色
export const textMuted        = "#6b7280";  // キャプション、パス表示、補助ラベルなど控えめな文字色
export const textFaint        = "#94a3b8";  // attribution、placeholder、disabled に近い非常に淡い文字色
export const textInverse      = "#ffffff";  // アクセント色など濃い背景の上に乗せる白文字


// =====================================================================================================================
// 2. 意味を持つカラー
// ---------------------------------------------------------------------------------------------------------------------
// 状態や意味に紐づく色です。単なる装飾色ではなく「成功・情報・警告・危険」の意味を持ちます。
// =====================================================================================================================

export const accent           = "#16a34a";  // メインアクセント色。選択中、編集モード、dynamic param、主要アクションに使う緑
export const accentHover      = "#15803d";  // メインアクセントのホバー色。緑ボタンにマウスを乗せたときに使う濃い緑
export const accentActive     = "#14532d";  // メインアクセントの押下色。緑ボタンを押している瞬間に使うさらに濃い緑
export const accentSoft       = "#ecfdf5";  // メインアクセントの淡い背景色。選択リング、緑バッジ、total count 背景に使う
export const accentSoftHover  = "#d1fae5";  // メインアクセントの淡いホバー背景色。淡い緑 UI を少し強めたいときに使う
export const accentText       = "#15803d";  // メインアクセント系の文字色。緑バッジ内テキストや選択中タブの文字に使う
export const accentBorder     = "#86efac";  // メインアクセント系の枠線色。選択ノード周辺や緑バッジ枠に使う薄い緑

export const info             = "#0284c7";  // 情報色。runtime sync、swap、on relaunch など情報系アクションに使う青
export const infoSoft         = "#e0f2fe";  // 情報色の淡い背景色。sync ボタン、swap メトリクス、on relaunch バッジに使う
export const infoText         = "#075985";  // 情報色の文字色。青いバッジや sync ボタン内テキストに使う
export const infoBorder       = "#7dd3fc";  // 情報色の枠線色。青いバッジや direct count の枠に使う

export const warning          = "#d97706";  // 警告色。上書き済み、dirty、restart 必須など注意が必要な状態に使う橙
export const warningSoft      = "#fef3c7";  // 警告色の淡い背景色。static parameter、on restart、dirty バッジに使う
export const warningText      = "#b45309";  // 警告色の文字色。dirty 表示や警告バッジ内テキストに使う
export const warningBorder    = "#fcd34d";  // 警告色の枠線色。dirty ノード枠や警告バッジ枠に使う

export const danger           = "#dc2626";  // 危険色。削除、無効化、エラーなど強く注意したい状態に使う赤
export const dangerSoft       = "#fee2e2";  // 危険色の淡い背景色。disabled バッジや危険ボタンの背景に使う
export const dangerText       = "#b91c1c";  // 危険色の文字色。disabled バッジやエラー表示の文字に使う
export const dangerBorder     = "#fca5a5";  // 危険色の枠線色。disabled ボタンや危険状態の枠に使う


// =====================================================================================================================
// 3. クラスタ・カテゴリカラー
// ---------------------------------------------------------------------------------------------------------------------
// Topic Graph のカテゴリ色です。ノード上端ストライプ、クラスタフレーム、Collapse Category ボタンに使います。
// =====================================================================================================================

export const clusterColors = {
  sensing:      "#2563eb",  // sensing 系カテゴリ色。lidar / camera / imu / gnss などセンサー入力系ノードに使う青
  perception:   "#0d9488",  // perception 系カテゴリ色。detection / tracking / object recognition など認識系ノードに使うティール
  localization: "#7c3aed",  // localization 系カテゴリ色。ndt / ekf / gnss_poser など自己位置推定系ノードに使う紫
  planning:     "#ca8a04",  // planning 系カテゴリ色。behavior planner / route / trajectory など経路計画系ノードに使う黄土色
  control:      "#ea580c",  // control 系カテゴリ色。mpc / pure_pursuit / vehicle_cmd など制御系ノードに使う橙
  vehicle:      "#0891b2",  // vehicle 系カテゴリ色。can / serial / dio など車両ハードウェア接続系ノードに使うシアン
  system:       "#64748b",  // system 系カテゴリ色。diagnostic / monitor / evaluator など監視・評価系ノードに使うスレート
  other:        "#94a3b8"   // other 系カテゴリ色。分類できないノードや fallback に使うライトグレー
} as const;


// =====================================================================================================================
// 4. 影
// ---------------------------------------------------------------------------------------------------------------------
// UI の階層感を出すための box-shadow です。強くしすぎると業務ツール感が崩れるので控えめにします。
// =====================================================================================================================

export const shadowSm = "0 1px 2px rgba(15, 23, 42, 0.05)";    // 最小限の影。通常ノード、軽いボタン、凡例の小さな浮きに使う
export const shadowMd = "0 4px 12px rgba(15, 23, 42, 0.08)";   // 中程度の影。浮動ボタン、React Flow controls、モード切替に使う
export const shadowLg = "0 12px 28px rgba(15, 23, 42, 0.12)";  // 強い影。将来のモーダルや大きなポップオーバー用


// =====================================================================================================================
// 5. 角丸
// ---------------------------------------------------------------------------------------------------------------------
// 角丸は UI の手触りに直結します。カードは大きくしすぎず、業務ツールとして控えめにします。
// =====================================================================================================================

export const radiusSm   = 6;    // 小さい角丸 px。メトリクス枠、リスト、細かいバッジに使う
export const radiusMd   = 10;   // 標準角丸 px。ボタン、入力欄、ノードカード、モード切替に使う
export const radiusLg   = 12;   // 大きめ角丸 px。クラスタフレーム、サイドパネルのまとまりに使う
export const radiusXl   = 16;   // さらに大きい角丸 px。将来の大きなパネルやダイアログ用
export const radiusPill = 999;  // ピル型角丸 px。ステータスバッジ、タグ、丸みの強いトグルに使う


// =====================================================================================================================
// 6. 文字
// ---------------------------------------------------------------------------------------------------------------------
// フォントサイズとフォントファミリです。画面密度を保つため、本文は 14px 以下中心で設計しています。
// =====================================================================================================================

export const fontXs  = 11;  // 極小文字 px。バッジ、エッジラベル、キャプション、クラスタフレーム補足に使う
export const fontSm  = 12;  // 小さい文字 px。補足テキスト、ボタン、フォーム、ノードメタ情報に使う
export const fontMd  = 14;  // 標準本文 px。ノード名、通常本文、セクション内の主要テキストに使う
export const fontLg  = 16;  // 小見出し px。Launch Setup の h2 など中程度の見出しに使う
export const fontXl  = 18;  // パネル見出し px。右側詳細パネルの h2 など強い見出しに使う
export const font2xl = 20;  // 大見出し px。将来のページタイトルや大型見出し用

export const fontWeightRegular  = 400;  // 通常文字の太さ。本文や通常ボタン文字に使う
export const fontWeightMedium   = 500;  // 中間の太さ。フォームラベルや控えめな強調に使う
export const fontWeightSemiBold = 600;  // やや太い文字。ボタン強調、バッジ、セクション見出しに使う
export const fontWeightBold     = 700;  // 太字。アプリタイトル、ノード重要数値、主要見出しに使う

export const fontFamilySans =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';  // 通常 UI 用フォント。アプリ全体、ボタン、本文に使う

export const fontFamilyMono =
  'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace';  // 等幅フォント。ノード名、トピック名、launch path、parameter key に使う


// =====================================================================================================================
// 7. 共通フォーム・ボタン
// ---------------------------------------------------------------------------------------------------------------------
// GlobalStyles と各 styled component が参照するフォーム系の標準値です。
// =====================================================================================================================

export const controlPaddingY       = 8;    // 通常ボタン・入力欄の上下 padding px
export const controlPaddingX       = 12;   // 通常ボタン・入力欄の左右 padding px
export const controlCompactPaddingY = 6;   // 小さめボタン・モード切替ボタンの上下 padding px
export const controlCompactPaddingX = 12;  // 小さめボタン・モード切替ボタンの左右 padding px
export const controlMinHeight      = 36;   // 入力欄や select の最小高さ px
export const controlFocusRingWidth = 3;    // focus-visible の外側リング太さ px
export const transitionFastMs      = 120;  // hover / active / border-color など短い UI 遷移の時間 ms


// =====================================================================================================================
// 8. アプリ全体レイアウト
// ---------------------------------------------------------------------------------------------------------------------
// 画面の大枠、ツールバー、左右パネル、グラフ表示領域に関わる値です。
// =====================================================================================================================

export const appViewportWidth  = "100vw";             // アプリルートの横幅。画面幅いっぱいに使う
export const appViewportHeight = "100vh";             // アプリルートの高さ。画面高さいっぱいに使う
export const appGridRows       = "auto minmax(0, 1fr)"; // アプリ全体の行構成。上が toolbar、下が main layout

export const launchPanelWidth          = 320;   // 左の Launch Setup パネル幅 px
export const detailsPanelMinWidth      = 360;   // 右の Property Panel の最小幅 px
export const detailsPanelWidthPercent  = 30;    // 右の Property Panel の通常幅 %
export const graphCollapsedWidthPercent = 70;   // Launch panel を閉じたときの Graph 領域幅 %

export const toolbarPaddingY = 12;  // ツールバー上下 padding px
export const toolbarPaddingX = 16;  // ツールバー左右 padding px
export const toolbarGap      = 10;  // ツールバー内の縦方向 gap px
export const toolbarItemGapX = 12;  // ツールバー内の横方向 gap px
export const toolbarItemGapY = 8;   // ツールバー内で折り返したときの縦 gap px
export const toolbarMobileBreakpoint = 900; // ツールバーオプションの左寄せ切り替え幅 px

export const sidePanelPadding = 16;  // Launch Setup パネル内側 padding px
export const sidePanelGap     = 16;  // Launch Setup パネル内のセクション間 gap px

export const propertyPanelPaddingY = 18;  // Property Panel 上下 padding px
export const propertyPanelPaddingX = 20;  // Property Panel 左右 padding px


// =====================================================================================================================
// 9. 浮動 UI
// ---------------------------------------------------------------------------------------------------------------------
// グラフの上に浮くボタン、凡例、モード切替、クラスタ折りたたみ操作などの位置とサイズです。
// =====================================================================================================================

export const floatingUiTop        = 12;  // Graph mode toggle などの上位置 px
export const floatingUiLeft       = 12;  // Graph mode toggle、凡例、cluster reset の左位置 px
export const floatingUiRight      = 12;  // 右側オーバーレイや Optimize Layout の右位置 px
export const floatingUiZIndex     = 9;   // 最前面に出す浮動 UI の z-index
export const graphOverlayZIndex   = 8;   // React Flow controls や凡例など、通常オーバーレイの z-index
export const graphLegendZIndex    = 5;   // edit mode の swap legend の z-index

export const graphModeToggleGap     = 4;   // Topic Graph / Launch Graph 切替ボタン間の gap px
export const graphModeTogglePadding = 4;   // Graph mode toggle 外枠の padding px
export const graphOptimizeTop       = 10;  // Optimize Layout ボタン上位置 px

export const clusterResetTop      = 62;  // Topic Graph の Collapse category パネル上位置 px
export const clusterResetMaxWidth = 620; // Collapse category の最大幅 px
export const clusterResetViewportReserve = 440; // Collapse category が右パネル等と被らないよう残す横幅 px


// =====================================================================================================================
// 10. ノードカード
// ---------------------------------------------------------------------------------------------------------------------
// Topic Graph の Autoware node / cluster node / package node の見た目です。
// =====================================================================================================================

export const autowareNodeWidth       = 260; // Topic Graph 通常ノードカード幅 px
export const autowareNodeMinHeight   = 136; // Topic Graph 通常ノードカード最小高さ px。レイアウト計算の標準ノード高さにも使う
export const categoryNodeScale       = 1.3; // 展開前カテゴリノードを通常ノードより縦横何倍にするか
export const categoryNodeWidth       = Math.round(autowareNodeWidth * categoryNodeScale); // 展開前カテゴリノードカード幅 px。通常ノード幅の 1.3 倍
export const categoryNodeMinHeight   = Math.round(autowareNodeMinHeight * categoryNodeScale); // 展開前カテゴリノードカード最小高さ px。通常ノード高さの 1.3 倍
export const nodeTitleMinHeight      = 32;  // 通常ノードタイトル帯の最小高さ px
export const nodeTitleSplitMinHeight = 50;  // namespace / leaf に分割したノードタイトル帯の最小高さ px
export const nodeTitlePaddingY       = 9;   // 通常ノードタイトル帯の上下 padding px
export const nodeTitlePaddingX       = 12;  // ノードタイトル帯の左右 padding px
export const nodeTitleSplitPaddingY  = 8;   // 分割ノードタイトル帯の上下 padding px
export const nodeTitleSplitGap       = 3;   // namespace と leaf の間隔 px
export const nodeTitleCategoryColorMixAlpha = 14; // 展開後の通常ノードタイトル帯に混ぜるカテゴリ色の割合 %
export const nodeMetaPaddingTop      = 8;   // ノード meta 行の上 padding px
export const nodeMetaPaddingX        = 12;  // ノード meta 行の左右 padding px
export const nodeMetaPaddingBottom   = 4;   // ノード meta 行の下 padding px
export const nodeMetricHeight        = 22;  // SW / P / D メトリクス pill の高さ px
export const nodeMetricGap           = 6;   // SW / P / D メトリクス間の gap px
export const nodeMetricsPaddingTop   = 8;   // ノードメトリクス領域の上 padding px
export const nodeMetricsPaddingX     = 10;  // ノードメトリクス領域の左右 padding px
export const nodeMetricsPaddingBottom = 9;  // ノードメトリクス領域の下 padding px
export const nodeBadgeTop            = 8;   // disabled / added バッジの上位置 px
export const nodeBadgeRight          = 8;   // disabled / added バッジの右位置 px
export const nodeDisabledOpacity     = 0.45; // disabled ノードの透明度


// =====================================================================================================================
// 11. Launch Graph ノード
// ---------------------------------------------------------------------------------------------------------------------
// Launch Graph の launch file node の見た目です。
// =====================================================================================================================

export const launchNodeWidth            = 300; // Launch Graph ノード幅 px
export const launchNodeMinHeight        = 136; // Launch Graph ノード最小高さ px
export const launchNodeTitleMinHeight   = 36;  // Launch Graph ノードタイトル帯の最小高さ px
export const launchNodeTitlePaddingY    = 10;  // Launch Graph ノードタイトル帯の上下 padding px
export const launchNodeTitlePaddingX    = 12;  // Launch Graph ノードタイトル帯の左右 padding px
export const launchNodeMetaPaddingTop   = 10;  // Launch Graph メタ行の上 padding px
export const launchNodeMetaPaddingX     = 12;  // Launch Graph メタ行の左右 padding px
export const launchNodeCountsGap        = 8;   // direct / total count pill の gap px
export const launchNodeListMaxHeight    = 132; // ROS nodes リストの最大高さ px
export const launchNodeListPaddingY     = 6;   // ROS nodes リストの上下 padding px
export const launchNodeListPaddingX     = 8;   // ROS nodes リストの左右 padding px
export const launchNodeGhostOpacity     = 0.45; // ghost launch node の透明度


export const clusterNodeTitleColorMixAlpha = 14;  // cluster node のタイトル背景に混ぜるカテゴリ色の割合 %


// =====================================================================================================================
// 13. Canvas レイヤー
// ---------------------------------------------------------------------------------------------------------------------
// CanvasEdges が使う 3 枚の canvas の重なり順です。
// =====================================================================================================================

export const canvasFramesZIndex      = 0; // カテゴリ枠（背景）を描く canvas の z-index。エッジより後ろ＝線が枠に隠れない
export const canvasEdgesBaseZIndex   = 1; // 非選択エッジを描く canvas の z-index
export const canvasEdgesActiveZIndex = 6; // 選択中エッジを描く canvas の z-index
export const canvasEdgesLabelZIndex  = 7; // 選択中エッジラベルを描く canvas の z-index
export const reactFlowNodesZIndex    = 2; // React Flow ノードレイヤーの z-index
export const reactFlowControlsZIndex = 8; // React Flow controls / minimap の z-index

// カテゴリ枠（展開カテゴリの背景フレーム）の見た目。canvas に world unit で描くため zoom に追従する。
export const clusterFrameFillAlpha     = 0.07; // 枠内側の塗り透明度（カテゴリ色を薄く敷く）
export const clusterFrameBorderWidth   = 1.5;  // 枠線の太さ(world)
export const clusterFrameBorderDash    = 6;    // 枠線の破線パターン長(world)
export const clusterFrameRadius        = 14;   // 枠の角丸(world)
export const clusterFrameLabelHeight   = 20;   // 枠ラベル（カテゴリ名pill）の高さ(world)
export const clusterFrameLabelFontSize = 12;   // 枠ラベルの文字サイズ(world)
export const clusterFrameLabelPaddingX = 9;    // 枠ラベルの左右パディング(world)


// =====================================================================================================================
// 14. Topic Graph エッジ
// ---------------------------------------------------------------------------------------------------------------------
// CanvasEdges と src/lib/canvasEdges.ts が使う、トピック矢印の描画パラメータです。
// =====================================================================================================================

export const edgePortGap             = 0;    // エッジ端点をノード境界からどれだけ離すか px。0 ならノード境界にぴったり接続
export const edgeParallelSpacing     = 12;   // 同じ source / target 間に複数トピックがあるとき、縦方向にずらす間隔 px
export const edgePortSpreadMarginRatio = 0.16; // 同じノードに複数アクティブエッジが集まるとき、ノード縦辺の上下に空ける余白の割合
export const edgePortSpreadMarginMax = 26;   // ポート分散時に上下へ空ける余白の最大 px。ノードが高くても端に寄りすぎないようにする
export const edgeHoverHitTolerance   = 7;    // ホバー判定でエッジ曲線をどれだけ太く当たり判定するか px（world unit, zoom 連動）
export const edgeDimmedAlpha         = 0.16; // ホバー中、対象でないアクティブエッジ・ラベルを薄くするときの透明度
export const edgeWidthActive         = 3;    // 選択中エッジの線幅 px。入力/出力としてハイライトされたトピックを太く表示
export const edgeWidthDefault        = 1;    // 通常エッジの線幅 px。非選択状態のトピック線に使う
export const edgeWidthUnknown        = 1.1;  // unknown エッジの線幅 px。出所不明のトピック線に使う
export const edgeBezierControlMin    = 80;   // ベジェ曲線の制御点オフセット最小値 px。短い距離でも曲線らしく見せるための下限
export const edgeBezierControlRatio  = 0.45; // ベジェ曲線の制御点オフセット倍率。source-target 間距離に対する膨らみ具合

export const edgeColorActiveInput    = "#98fb98";  // subscribe 入力として選択中のエッジ色。入力方向を示す淡い緑
export const edgeColorActiveOutput   = "#87cefa";  // publish 出力として選択中のエッジ色。出力方向を示す淡い青
export const edgeColorActiveBoth     = "#16a34a";  // 入出力両方に関係する選択エッジ色。メインアクセント緑
export const edgeColorInactiveRgb    = "148, 163, 184"; // 非選択エッジ色の RGB 文字列。rgba() に差し込む灰色
export const edgeColorInactiveAlpha  = 0.28; // 非選択エッジの透明度。小さいほど背景に馴染む
export const edgeColorUnknownAlpha   = 0.28; // unknown エッジの透明度。通常非選択と同じ薄さ


// =====================================================================================================================
// 15. 矢印
// ---------------------------------------------------------------------------------------------------------------------
// CanvasEdges がトピックエッジの先端・始点に描く記号です。
// =====================================================================================================================

export const arrowSize    = 12; // エッジ target 側に描く三角矢印の長さ px
export const arrowDotSize = 4;  // エッジ source 側に描く小さな丸の半径 px


// =====================================================================================================================
// 16. エッジラベル
// ---------------------------------------------------------------------------------------------------------------------
// 選択中トピック名をエッジ横に表示するラベルの見た目です。Canvas world unit として扱います。
// =====================================================================================================================

export const edgeLabelHeight      = 18;   // エッジラベル背景矩形の高さ world unit
export const edgeLabelPaddingX    = 10;   // エッジラベル背景矩形の左右 padding world unit
export const edgeLabelGap         = 14;   // 矢印先端からラベルまでの距離 world unit
export const edgeLabelTargetYOffset = 0; // エッジ target 端点（ポート）からラベル中心をどれだけ上に置くか world unit。0 でポートと同じ高さに揃え、どの矢印のラベルか分かるようにする
export const edgeLabelCollisionGap  = 4;  // 複数のエッジラベルが重なりそうなとき、縦方向に空ける最小間隔 world unit
export const edgeLabelFontSize    = 11;   // エッジラベルの文字サイズ world unit。Canvas の zoom に連動
export const edgeLabelBg          = "rgba(255, 255, 255, 0.95)"; // エッジラベル背景色。ほぼ白の半透明
export const edgeLabelText        = "#0f172a";                   // エッジラベル文字色。本文と同じ濃紺
export const edgeLabelBorderAlpha = 0.6;                         // エッジラベル枠線の透明度。選択色にこの alpha をかける


// =====================================================================================================================
// 17. Launch Graph レイアウト計算
// ---------------------------------------------------------------------------------------------------------------------
// src/lib/launchGraphLayout.ts 側の配置計算で使う値の意味メモです。
// 現状は layout ファイル側に閉じていますが、見た目パラメータとしてここに同じ意味の定数を置いておきます。
// =====================================================================================================================

export const launchGraphEstimatedNodeBaseHeight = 146; // Launch Graph ノードの見積もり基礎高さ px。リストなしの高さ計算に使う
export const launchGraphListChromeHeight        = 42;  // Launch Graph ROS nodes リスト周辺の見積もり付加高さ px
export const launchGraphListItemHeight          = 22;  // Launch Graph ROS nodes リスト 1 行あたりの見積もり高さ px
export const launchGraphChildXGap               = 380; // Launch Graph で親 launch と子 launch の横方向距離 px
export const launchGraphSiblingYGap             = 28;  // Launch Graph で同階層 launch node 同士の縦方向 gap px
export const launchGraphRankSep                 = 120; // dagre layout の ranksep。左右階層間の距離 px
export const launchGraphNodeSep                 = 46;  // dagre layout の nodesep。同階層ノード間の距離 px
export const launchGraphMarginX                 = 24;  // dagre layout の左右 margin px
export const launchGraphMarginY                 = 24;  // dagre layout の上下 margin px
