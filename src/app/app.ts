import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  model,
  viewChild,
  signal,
} from '@angular/core';
import {
  EFConnectableSide,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
} from '@foblex/flow';
import { IPoint } from '@foblex/2d';
import {
  ReactiveFormsModule,
  FormControl,
  FormBuilder,
  FormsModule,
} from '@angular/forms';
import * as dagre from 'dagre';
import { graphlib } from 'dagre';
import Graph = graphlib.Graph;
import { generateGuid } from '@foblex/utils';
import { NgClass } from '@angular/common';

// 節點視圖模型介面：定義在 UI 中顯示的節點資料結構
interface INodeViewModel {
  id: string; // 視覺節點的唯一識別符（用於 Angular 追蹤）
  connectorId: string; // dagre 圖形庫使用的節點 ID（用於連線邏輯）
  position: IPoint; // 節點在畫布上的位置座標
  title: string; // 節點顯示的標題文字
  isEditing?: boolean; // 是否處於編輯模式（可選屬性）
}

// 連線視圖模型介面：定義節點之間的連接關係
interface IConnectionViewModel {
  id: string; // 連線的唯一識別符
  from: string; // 起始節點的 connectorId
  to: string; // 目標節點的 connectorId
}

@Component({
  selector: 'app-root',
  imports: [
    FFlowModule,
    FCanvasComponent,
    ReactiveFormsModule,
    FormsModule,
    NgClass,
  ],
  // 需要 FormsModule 來支援 ngModel
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
})
export class App implements OnInit {
  // 取得 FFlowComponent 的參考（用於呼叫 reset() 等方法）
  _flow = viewChild(FFlowComponent);
  // 取得 FCanvasComponent 的參考（必要的畫布元件）
  _canvas = viewChild.required(FCanvasComponent);
  // 儲存所有節點的響應式信號
  nodes = signal<INodeViewModel[]>([]);
  // 儲存所有連線的響應式信號
  connections = signal<IConnectionViewModel[]>([]);
  // 當前的佈局配置（連接點位置等）
  configuration = signal(CONFIGURATION[Direction.TOP_TO_BOTTOM]);
  // 是否啟用自動佈局模式
  isAutoLayout = model(true);
  // 是否啟用縮放功能
  isZoomEnabled = true;

  /**
   * 主要的圖形數據處理方法：負責整合 dagre 佈局計算與 UI 更新
   * @param graph - dagre 圖形物件
   * @param direction - 佈局方向（垂直或水平）
   */
  _getData(graph: Graph, direction: Direction) {
    // 如果啟用了自動佈局，則在更新圖形之前重置畫布狀態
    if (this.isAutoLayout()) {
      this._flow()?.reset();
    }
    // 設定 dagre 圖形屬性並執行自動佈局計算
    this._updateGraph(graph, direction);
    // 將 dagre 計算的結果轉換為 UI 使用的節點資料
    this.nodes.set(this._calculateNodes(graph));
    // 將 dagre 的邊緣資料轉換為 UI 使用的連線資料
    this.connections.set(this._calculateConnections(graph));
  }

  /**
   * 更新 dagre 圖形並執行自動佈局計算
   * @param graph - dagre 圖形物件
   * @param direction - 佈局方向
   */
  _updateGraph(graph: Graph, direction: Direction) {
    // 設定 UI 配置（決定連接點在節點的哪一側）
    this.configuration.set(CONFIGURATION[direction]);
    // 告訴 dagre 圖形的排列方向（LR=左右，TB=上下）
    graph.setGraph({ rankdir: direction });
    // 將所有節點資料加入到 dagre 圖形中
    GRAPH_DATA.forEach((node) => {
      // 為每個節點設定 ID 和預設尺寸（寬120px，高73px）
      graph.setNode(node.id, { width: 120, height: 73 });
      // 如果節點有父節點，建立父子連線關係
      if (node.parentId != null) {
        graph.setEdge(node.parentId, node.id, {});
      }
    });
    // 執行 dagre 自動佈局演算法，計算最佳節點位置
    dagre.layout(graph);
  }

  /**
   * 將 dagre 計算的節點資料轉換為 UI 顯示用的節點視圖模型
   * @param graph - 已經過佈局計算的 dagre 圖形
   * @returns 節點視圖模型陣列
   */
  _calculateNodes(graph: Graph) {
    return graph.nodes().map((x) => {
      // 取得 dagre 計算後的節點位置和尺寸資訊
      const node = graph.node(x);
      // 從原始資料中找到對應的節點，取得標題等額外資訊
      const graphData = GRAPH_DATA.find((gd) => gd.id === x);
      return {
        id: generateGuid(), // 產生唯一的視覺 ID（供 Angular 追蹤）
        connectorId: x, // dagre 節點 ID（用於連線邏輯）
        position: { x: node.x, y: node.y }, // dagre 計算的最佳位置
        title: graphData?.title || x, // 顯示標題（優先使用自訂標題）
        isEditing: false, // 預設不在編輯模式
      };
    });
  }

  private _calculateConnections(graph: Graph) {
    return graph
      .edges()
      .map((x) => ({ id: generateGuid(), from: x.v, to: x.w }));
  }

  horizontal() {
    this._getData(new dagre.graphlib.Graph(), Direction.LEFT_TO_RIGHT);
  }

  vertical() {
    this._getData(new dagre.graphlib.Graph(), Direction.TOP_TO_BOTTOM);
  }

  //   =================================================
  editingNodeId = signal<string | null>(null);
  editingNodeTitle = signal<string>('');

  startEdit(nodeId: string) {
    this.editingNodeId.set(nodeId);
    // 找到節點並設定編輯的標題
    const node = this.nodes().find((n) => n.id === nodeId);
    if (node) {
      this.editingNodeTitle.set(node.title);
    }
  }

  finishEdit() {
    this.updateNodeTitle();
    this.editingNodeId.set(null);
  }

  updateNodeTitle() {
    const editingId = this.editingNodeId();
    const newTitle = this.editingNodeTitle();
    if (editingId && newTitle.trim()) {
      // 更新節點標題
      this.nodes.update((nodes) =>
        nodes.map((node) =>
          node.id === editingId ? { ...node, title: newTitle.trim() } : node,
        ),
      );
      // 同步更新 GRAPH_DATA
      const node = this.nodes().find((n) => n.id === editingId);
      if (node) {
        const graphNodeIndex = GRAPH_DATA.findIndex(
          (gn) => gn.id === node.connectorId,
        );
        if (graphNodeIndex !== -1) {
          GRAPH_DATA[graphNodeIndex] = {
            ...GRAPH_DATA[graphNodeIndex],
            title: newTitle.trim(),
          };
          // 保存到 localStorage
          this.saveGraphData();
        }
      }
    }
  }

  /**
   * 在指定父節點下新增子節點
   * @param parentConnectorId - 父節點的 connectorId
   */
  addChildNode(parentConnectorId: string) {
    // 產生新節點的唯一 ID
    const newNodeId = `Node${Date.now()}`;
    const newNode = {
      id: newNodeId,
      parentId: parentConnectorId,
      title: `New Node ${GRAPH_DATA.length + 1}`,
    };

    // 將新節點加入到原始資料中
    GRAPH_DATA.push(newNode);

    // 儲存到本地儲存
    this.saveGraphData();

    // 重新計算並顯示新的佈局
    this._getData(new dagre.graphlib.Graph(), this.getCurrentDirection());
  }

  /**
   * 刪除指定節點及其所有子節點（帶有確認對話框）
   * @param nodeConnectorId - 要刪除的節點 connectorId
   */
  removeNode(nodeConnectorId: string) {
    // 檢查節點是否有子分支
    if (this.hasChildNodes(nodeConnectorId)) {
      // 計算將被刪除的節點總數
      const nodesToDelete = this.getNodeAndChildren(nodeConnectorId);
      const childCount = nodesToDelete.length - 1; // 減去本身節點

      // 顯示警告確認對話框
      const confirmed = confirm(
        `警告！此節點下方還有 ${childCount} 個子分支。\n` +
          `如果繼續刪除，將會同時刪除所有子分支（共 ${nodesToDelete.length} 個節點）。\n\n` +
          `您確定要繼續刪除嗎？`,
      );

      // 如果用戶取消，則不執行刪除
      if (!confirmed) {
        return;
      }
    }

    // 執行刪除邏輯
    this.performNodeDeletion(nodeConnectorId);
  }

  /**
   * 執行實際的節點刪除操作
   * @param nodeConnectorId - 要刪除的節點 connectorId
   */
  private performNodeDeletion(nodeConnectorId: string) {
    // 遞迴找出該節點和其所有子節點
    const nodesToRemove = this.getNodeAndChildren(nodeConnectorId);

    // 從原始資料中移除所有相關節點
    nodesToRemove.forEach((nodeId) => {
      const index = GRAPH_DATA.findIndex((node) => node.id === nodeId);
      if (index !== -1) {
        GRAPH_DATA.splice(index, 1);
      }
    });

    // 儲存到本地儲存
    this.saveGraphData();

    // 重新計算並顯示新的佈局
    this._getData(new dagre.graphlib.Graph(), this.getCurrentDirection());
  }

  /**
   * 遞迴取得指定節點及其所有子孫節點的 ID 列表
   * @param nodeId - 起始節點 ID
   * @returns 包含該節點及其所有子孫節點的 ID 陣列
   */
  private getNodeAndChildren(nodeId: string): string[] {
    const result = [nodeId];
    // 找到該節點的直接子節點
    const children = GRAPH_DATA.filter((node) => node.parentId === nodeId);
    // 遞迴處理每個子節點
    children.forEach((child) => {
      result.push(...this.getNodeAndChildren(child.id));
    });
    return result;
  }

  /**
   * 檢查指定節點是否有直接子節點
   * @param nodeId - 要檢查的節點 ID
   * @returns 如果有子節點返回 true，否則返回 false
   */
  private hasChildNodes(nodeId: string): boolean {
    return GRAPH_DATA.some((node) => node.parentId === nodeId);
  }

  private getCurrentDirection(): Direction {
    return this.configuration().outputSide === EFConnectableSide.RIGHT
      ? Direction.LEFT_TO_RIGHT
      : Direction.TOP_TO_BOTTOM;
  }

  onEditInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.finishEdit();
    }
  }

  /**
   * 判斷指定節點是否為根節點（沒有父節點）
   * @param connectorId - 節點的 connectorId
   * @returns 如果是根節點返回 true，否則返回 false
   */
  isRootNode(connectorId: string): boolean {
    const nodeData = GRAPH_DATA.find((node) => node.id === connectorId);
    return nodeData?.parentId === null;
  }

  fb = inject(FormBuilder);

  formBuilder = this.fb.group({
    title: this.fb.control('請填入標題'),
  });

  ngOnInit(): void {
    this.loadGraphData(); // 先載入圖形資料
    this.loadInfo();
    this.formBuilder.valueChanges.subscribe((val) => this.saveData(val));

    // 初始化圖形顯示
    this._getData(new dagre.graphlib.Graph(), Direction.TOP_TO_BOTTOM);
  }

  saveData(val: any) {
    try {
      const dataInfo = {
        formdata: val,
        test: this.test,
      };
      localStorage.setItem('giveAName', JSON.stringify(dataInfo));
    } catch (e) {
      console.warn('here we go again');
    }
  }

  clearData() {
    try {
      localStorage.removeItem('giveAName');
    } catch (e) {
      console.warn('here we go again');
    }
  }

  loadInfo(): void {
    const saveData = localStorage.getItem(this.formBuilder.value.title || '');
    if (saveData) {
      this.test = JSON.parse(saveData);
      this.formBuilder.patchValue({ title: this.formBuilder.value.title });
    }
  }

  // 保存圖形資料到 localStorage
  saveGraphData() {
    try {
      localStorage.setItem(
        'companyDiagramGraphData',
        JSON.stringify(GRAPH_DATA),
      );
    } catch (e) {
      console.warn('Failed to save graph data:', e);
    }
  }

  // 從 localStorage 載入圖形資料
  loadGraphData() {
    try {
      const savedData = localStorage.getItem('companyDiagramGraphData');
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        // 清空並重新填入 GRAPH_DATA
        GRAPH_DATA.length = 0;
        GRAPH_DATA.push(...parsedData);
      }
    } catch (e) {
      console.warn('Failed to load graph data:', e);
    }
  }

  test = [
    { id: 'node1', parentId: null },
    { id: 'node2', parentId: 'node1' },
    { id: 'node3', parentId: 'node1' },
  ];
}

enum Direction {
  LEFT_TO_RIGHT = 'LR',
  TOP_TO_BOTTOM = 'TB',
}

const CONFIGURATION = {
  [Direction.LEFT_TO_RIGHT]: {
    outputSide: EFConnectableSide.RIGHT,
    inputSide: EFConnectableSide.LEFT,
  },
  [Direction.TOP_TO_BOTTOM]: {
    outputSide: EFConnectableSide.BOTTOM,
    inputSide: EFConnectableSide.TOP,
  },
};

let GRAPH_DATA: Array<{
  id: string;
  parentId: string | null;
  title?: string;
}> = [
  { id: 'Node1w13r', parentId: null, title: 'Root Node' },
  { id: 'Node2', parentId: 'Node1w13r', title: 'Child Node 2' },
  { id: 'Node3', parentId: 'Node1w13r', title: 'Child Node 3' },
  { id: 'Node4', parentId: 'Node3', title: 'Child Node 4' },
  { id: 'Node5', parentId: 'Node3', title: 'Child Node 5' },
  { id: 'Node6', parentId: 'Node3', title: 'Child Node 6' },
  { id: 'Node7', parentId: 'Node3', title: 'Child Node 7' },
  { id: 'Node8', parentId: 'Node2', title: 'Child Node 8' },
  { id: 'Node9', parentId: 'Node7', title: 'Child Node 9' },
  { id: 'Node10', parentId: 'Node7', title: 'Child Node 10' },
  { id: 'Node11', parentId: 'Node3', title: 'Child Node 11' },
];
