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

interface INodeViewModel {
  id: string;
  connectorId: string;
  position: IPoint;
  title: string;
  isEditing?: boolean;
}

interface IConnectionViewModel {
  id: string;
  from: string;
  to: string;
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
  _flow = viewChild(FFlowComponent);
  _canvas = viewChild.required(FCanvasComponent);
  nodes = signal<INodeViewModel[]>([]);
  connections = signal<IConnectionViewModel[]>([]);
  configuration = signal(CONFIGURATION[Direction.TOP_TO_BOTTOM]);
  isAutoLayout = model(true);

  _getData(graph: Graph, direction: Direction) {
    // 如果啟用了自動佈局，則在更新圖形之前重置畫布
    if (this.isAutoLayout()) {
      this._flow()?.reset();
    }
    // 更新圖形並重新計算節點和連接的位置
    this._updateGraph(graph, direction);
    // 將計算出的節點和連接更新到信號中，以觸發 UI 的重新渲染
    this.nodes.set(this._calculateNodes(graph));
    // 這裡的 connections 是根據 graph 的邊緣計算出來的，並且每個連接都會有一個唯一的 id，以及 from 和 to 屬性對應到節點的 connectorId
    this.connections.set(this._calculateConnections(graph));
  }

  _updateGraph(graph: Graph, direction: Direction) {
    this.configuration.set(CONFIGURATION[direction]);
    graph.setGraph({ rankdir: direction });
    GRAPH_DATA.forEach((node) => {
      //這裡的 setNode 擷取了 node.id 作為 connectorId，並且設定了預設的寬高
      graph.setNode(node.id, { width: 120, height: 73 });
      if (node.parentId != null) {
        graph.setEdge(node.parentId, node.id, {});
      }
    });
    dagre.layout(graph);
  }

  _calculateNodes(graph: Graph) {
    return graph.nodes().map((x) => {
      const node = graph.node(x);
      // 從 GRAPH_DATA 中找到對應的節點資料，以便獲取標題等資訊
      const graphData = GRAPH_DATA.find((gd) => gd.id === x);
      return {
        id: generateGuid(),
        connectorId: x,
        position: { x: node.x, y: node.y },
        title: graphData?.title || x, // 使用 GRAPH_DATA 中的標題或 connectorId 作為備用
        isEditing: false, // 預設不在編輯狀態
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

  addChildNode(parentConnectorId: string) {
    // 產生新節點
    const newNodeId = `Node${Date.now()}`;
    const newNode = {
      id: newNodeId,
      parentId: parentConnectorId,
      title: `New Node ${GRAPH_DATA.length + 1}`,
    };

    // 加入到 GRAPH_DATA
    GRAPH_DATA.push(newNode);

    // 保存到 localStorage
    this.saveGraphData();

    // 重新計算佈局
    this._getData(new dagre.graphlib.Graph(), this.getCurrentDirection());
  }

  removeNode(nodeConnectorId: string) {
    // 找出該節點和其所有子節點
    const nodesToRemove = this.getNodeAndChildren(nodeConnectorId);

    // 從 GRAPH_DATA 中移除
    nodesToRemove.forEach((nodeId) => {
      const index = GRAPH_DATA.findIndex((node) => node.id === nodeId);
      if (index !== -1) {
        GRAPH_DATA.splice(index, 1);
      }
    });

    // 保存到 localStorage
    this.saveGraphData();

    // 重新計算佈局
    this._getData(new dagre.graphlib.Graph(), this.getCurrentDirection());
  }

  private getNodeAndChildren(nodeId: string): string[] {
    const result = [nodeId];
    const children = GRAPH_DATA.filter((node) => node.parentId === nodeId);
    children.forEach((child) => {
      result.push(...this.getNodeAndChildren(child.id));
    });
    return result;
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
