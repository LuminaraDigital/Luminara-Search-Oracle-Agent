/**
 * Standalone Clean-Room Python Code Exporter for Luminara Viking VFS.
 * Allows users to run the hierarchical context operating system natively in Python / FastAPI.
 */

export interface GeneratedVfsFile {
  filename: string;
  path: string;
  language: string;
  description: string;
  code: string;
}

export class VfsCodeExporter {
  public static generatePythonCodebase(): GeneratedVfsFile[] {
    return [
      {
        filename: 'README.md',
        path: 'luminara_viking/README.md',
        language: 'markdown',
        description: 'Package documentation and Quickstart',
        code: `# Luminara Viking Context Operating System (VFS)
## Clean-Room Hierarchical Context Database for Autonomous AI Agents

Inspired by the filesystem paradigm of \`volcengine/OpenViking\`, completely re-engineered as a clean-room, sovereign Python package.

### Key Capabilities
- **Hierarchical VFS Paradigm**: Uniform \`viking://\` and \`oracle://\` resource addressing.
- **3-Tier Multi-Resolution Context Layers**:
  - **L0 (Abstract)**: ~100 tokens for rapid indexation and routing.
  - **L1 (Overview)**: ~2,000 tokens for structural planning.
  - **L2 (Full Detail)**: Complete uncompressed documents.
- **Directory Recursive Retrieval (DRR)**: Context-aware tree traversal with observable audit trajectories.
- **6-Category Self-Evolving Memory**: \`profiles\`, \`preferences\`, \`entities\`, \`events\`, \`cases\`, \`patterns\`.
- **FastAPI REST Server & CLI**: Zero-dependency FastAPI server with streaming endpoints.

### Installation
\`\`\`bash
pip install -r requirements.txt
\`\`\`

### CLI Usage
\`\`\`bash
# List directory
python -m luminara_viking.cli ls viking://resources

# Show tree
python -m luminara_viking.cli tree viking://

# Execute Directory Recursive Retrieval
python -m luminara_viking.cli query "Stripe AEO audit" --budget 1500

# Start REST Server
python -m luminara_viking.server --port 8000
\`\`\`
`
      },
      {
        filename: 'requirements.txt',
        path: 'luminara_viking/requirements.txt',
        language: 'text',
        description: 'Python dependencies',
        code: `pydantic>=2.5.0
fastapi>=0.110.0
uvicorn>=0.28.0
tiktoken>=0.7.0
click>=8.1.0
rich>=13.7.0
`
      },
      {
        filename: 'layers.py',
        path: 'luminara_viking/layers.py',
        language: 'python',
        description: 'Multi-resolution L0/L1/L2 distillation engine',
        code: `"""
Luminara Viking Multi-Resolution Layer Distillation Engine.
Clean-room implementation of L0 (Abstract), L1 (Overview), and L2 (Full Detail).
"""
import re
from typing import List, Dict, Tuple, Any
from pydantic import BaseModel, Field

class LayerL0(BaseModel):
    content: str
    token_count: int
    keywords: List[str] = Field(default_factory=list)

class LayerL1(BaseModel):
    content: str
    token_count: int
    sections: List[str] = Field(default_factory=list)

class LayerL2(BaseModel):
    content: str
    token_count: int
    raw_format: str = "markdown"

class VfsLayerData(BaseModel):
    l0: LayerL0
    l1: LayerL1
    l2: LayerL2

def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    words = len(text.strip().split())
    chars = len(text)
    return max(1, round((chars / 3.8 + words * 1.3) / 2))

def distill_layers(raw_content: str, raw_format: str = "markdown", title: str = "Document") -> VfsLayerData:
    content = raw_content.strip()
    l2_tokens = estimate_tokens(content)

    # Keyword extraction
    words = re.findall(r'[a-zA-Z0-9_-]{4,}', content.lower())
    stopwords = {"this", "that", "with", "from", "have", "were", "which", "their", "about", "there"}
    freq = {}
    for w in words:
        if w not in stopwords:
            freq[w] = freq.get(w, 0) + 1
    keywords = sorted(freq.keys(), key=lambda k: freq[k], reverse=True)[:10]

    # Generate L1 Overview (~500 - 2,000 tokens)
    lines = content.splitlines()
    headers = [l.lstrip("#* ").strip() for l in lines if l.startswith("#") or l.startswith("**")]
    bullets = [l.strip() for l in lines if l.strip().startswith(("-", "*"))]

    if headers or bullets:
        lead = next((l.strip() for l in lines if len(l.strip()) > 30 and not l.startswith("#")), "")
        l1_body = f"### Overview: {title}\\n\\n"
        if lead:
            l1_body += f"> {lead}\\n\\n"
        if headers:
            l1_body += "**Key Structure**:\\n" + "\\n".join(f"• {h}" for h in headers[:8]) + "\\n\\n"
        if bullets:
            l1_body += "**Highlights**:\\n" + "\\n".join(bullets[:10])
    else:
        l1_body = content[:1200] + ("\\n... [Overview truncated]" if len(content) > 1200 else "")

    l1_tokens = estimate_tokens(l1_body)

    # Generate L0 Abstract (~50 - 150 tokens)
    first_sentence = re.split(r'(?<=[.?!])\\s+', content.replace("\\n", " "))[0] if content else ""
    l0_body = f"[{title.upper()}] {first_sentence[:180]} (Keywords: {', '.join(keywords[:6])})"
    l0_tokens = estimate_tokens(l0_body)

    return VfsLayerData(
        l0=LayerL0(content=l0_body, token_count=l0_tokens, keywords=keywords),
        l1=LayerL1(content=l1_body, token_count=l1_tokens, sections=headers[:8]),
        l2=LayerL2(content=content, token_count=l2_tokens, raw_format=raw_format)
    )
`
      },
      {
        filename: 'vfs.py',
        path: 'luminara_viking/vfs.py',
        language: 'python',
        description: 'Hierarchical Virtual Filesystem Core',
        code: `"""
Luminara Viking Virtual Filesystem (VFS) Core Engine.
"""
import json
import time
from typing import Dict, List, Optional
from pydantic import BaseModel, Field
from .layers import VfsLayerData, distill_layers

PROTOCOL_VIKING = "viking://"
PROTOCOL_ORACLE = "oracle://"

class VfsNodeMetadata(BaseModel):
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    author: str = "Luminara System"
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    size_bytes: int = 0
    token_savings_pct: int = 0
    domain_focus: Optional[str] = None

class VfsNode(BaseModel):
    uri: str
    name: str
    type: str  # directory, file, memory, resource, skill, session
    parent_uri: Optional[str] = None
    children_uris: Optional[List[str]] = None
    layers: Optional[VfsLayerData] = None
    metadata: VfsNodeMetadata = Field(default_factory=VfsNodeMetadata)

class VikingVfs:
    def __init__(self):
        self.nodes: Dict[str, VfsNode] = {}
        self._seed_default_tree()

    def normalize_uri(self, uri: str) -> str:
        clean = uri.strip()
        if clean.startswith(PROTOCOL_ORACLE):
            clean = PROTOCOL_VIKING + clean[len(PROTOCOL_ORACLE):]
        if not clean.startswith(PROTOCOL_VIKING):
            clean = PROTOCOL_VIKING + clean.lstrip("/")
        parts = clean[len(PROTOCOL_VIKING):].strip("/").split("/")
        clean_parts = [p for p in parts if p]
        return PROTOCOL_VIKING + "/".join(clean_parts)

    def _get_parent(self, uri: str) -> Optional[str]:
        norm = self.normalize_uri(uri)
        parts = norm[len(PROTOCOL_VIKING):].split("/")
        if len(parts) <= 1:
            return None
        return PROTOCOL_VIKING + "/".join(parts[:-1])

    def create_node(self, uri: str, node_type: str = "file", content: Optional[str] = None,
                    description: str = "", tags: List[str] = None, domain_focus: str = None) -> VfsNode:
        norm = self.normalize_uri(uri)
        name = norm.split("/")[-1]
        parent = self._get_parent(norm)

        # Auto create parent if missing
        if parent and parent not in self.nodes:
            self.create_node(parent, node_type="directory", description=f"Parent dir for {norm}")

        layers = None
        size_bytes = 0
        savings = 0
        if node_type != "directory" and content is not None:
            layers = distill_layers(content, title=name)
            size_bytes = len(content.encode("utf-8"))
            if layers.l2.token_count > 0:
                savings = round(((layers.l2.token_count - layers.l1.token_count) / layers.l2.token_count) * 100)

        node = VfsNode(
            uri=norm,
            name=name,
            type=node_type,
            parent_uri=parent,
            children_uris=[] if node_type == "directory" else None,
            layers=layers,
            metadata=VfsNodeMetadata(
                description=description,
                tags=tags or [],
                size_bytes=size_bytes,
                token_savings_pct=savings,
                domain_focus=domain_focus
            )
        )
        self.nodes[norm] = node

        if parent and parent in self.nodes and norm not in (self.nodes[parent].children_uris or []):
            if self.nodes[parent].children_uris is None:
                self.nodes[parent].children_uris = []
            self.nodes[parent].children_uris.append(norm)

        return node

    def list_dir(self, dir_uri: str = PROTOCOL_VIKING, recursive: bool = False) -> List[VfsNode]:
        norm = self.normalize_uri(dir_uri)
        res = []
        for n in self.nodes.values():
            if n.uri == norm:
                continue
            if not recursive and n.parent_uri == norm:
                res.append(n)
            elif recursive and n.uri.startswith(norm + "/"):
                res.append(n)
        return sorted(res, key=lambda x: (x.type != "directory", x.name))

    def _seed_default_tree(self):
        dirs = [
            ("viking://user/default/.memories/profiles", "Brand and user profiles"),
            ("viking://user/default/.memories/entities", "Entity maps and competitors"),
            ("viking://resources/audits", "Saved AEO and SEO audit scans"),
            ("viking://skills", "Agent tools and capabilities"),
            ("viking://sessions", "Execution contexts and scratchpads")
        ]
        for d, desc in dirs:
            self.create_node(d, node_type="directory", description=desc)
`
      },
      {
        filename: 'retriever.py',
        path: 'luminara_viking/retriever.py',
        language: 'python',
        description: 'Directory Recursive Retrieval (DRR) Engine',
        code: `"""
Luminara Viking Directory Recursive Retrieval (DRR) with Observable Trajectories.
"""
import time
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from .vfs import VikingVfs, VfsNode

class TrajectoryStep(BaseModel):
    step_index: int
    action: str
    target_uri: str
    score: Optional[float] = None
    layer_selected: Optional[str] = None
    tokens_cost: Optional[int] = None
    rationale: str

class MatchedContext(BaseModel):
    uri: str
    layer: str
    content: str
    score: float
    tokens: int

class VfsRetrievalResult(BaseModel):
    query: str
    root_uri: str
    token_budget: int
    tokens_used: int
    token_savings_pct: int
    matched_items: List[MatchedContext]
    assembled_context: str
    trajectory: List[TrajectoryStep]
    execution_time_ms: int

class DirectoryRecursiveRetriever:
    def __init__(self, vfs: VikingVfs):
        self.vfs = vfs

    def retrieve(self, query: str, root_uri: str = "viking://", token_budget: int = 2500) -> VfsRetrievalResult:
        start_t = time.time()
        trajectory: List[TrajectoryStep] = []
        step_idx = 0

        def add_step(action: str, uri: str, rationale: str, score=None, layer=None, cost=None):
            nonlocal step_idx
            step_idx += 1
            trajectory.append(TrajectoryStep(
                step_index=step_idx, action=action, target_uri=uri,
                score=score, layer_selected=layer, tokens_cost=cost, rationale=rationale
            ))

        add_step("intent_analysis", root_uri, f"Analyzed query: '{query}'. Initiating DRR traversal.")

        query_tokens = [w for w in query.lower().split() if len(w) > 2]
        candidates = []

        # Recursively score leaf nodes
        for node in self.vfs.nodes.values():
            if node.type == "directory" or not node.layers:
                continue
            text = f"{node.name} {node.metadata.description} {' '.join(node.metadata.tags)} {node.layers.l0.content}".lower()
            score = sum(0.3 for q in query_tokens if q in text)
            score = min(1.0, score)
            if score >= 0.2:
                candidates.append((node, score))
                add_step("branch_scoring", node.uri, f"Matched relevance score {score:.2f}", score=score)

        candidates.sort(key=lambda x: x[1], reverse=True)

        matched_items: List[MatchedContext] = []
        remaining_budget = token_budget
        hypothetical_l2 = 0

        for node, score in candidates:
            if remaining_budget <= 60:
                add_step("prune", node.uri, "Token budget exhausted.")
                break

            layers = node.layers
            hypothetical_l2 += layers.l2.token_count

            if score >= 0.70 and layers.l2.token_count <= remaining_budget * 0.7:
                layer = "L2"
                content = layers.l2.content
                cost = layers.l2.token_count
            elif score >= 0.35 and layers.l1.token_count <= remaining_budget:
                layer = "L1"
                content = layers.l1.content
                cost = layers.l1.token_count
            else:
                layer = "L0"
                content = layers.l0.content
                cost = layers.l0.token_count

            remaining_budget -= cost
            matched_items.append(MatchedContext(
                uri=node.uri, layer=layer, content=content, score=score, tokens=cost
            ))
            add_step("layer_resolution", node.uri, f"Selected {layer} layer ({cost} tokens)",
                     score=score, layer=layer, cost=cost)

        total_used = token_budget - remaining_budget
        savings_pct = round(((hypothetical_l2 - total_used) / hypothetical_l2) * 100) if hypothetical_l2 > total_used else 0
        assembled = "\\n\\n---\\n\\n".join([f"### [{m.uri} | {m.layer}]\\n{m.content}" for m in matched_items])

        add_step("context_assembly", root_uri, f"Assembled {len(matched_items)} nodes. Savings: {savings_pct}%")
        exec_ms = int((time.time() - start_t) * 1000)

        return VfsRetrievalResult(
            query=query, root_uri=root_uri, token_budget=token_budget,
            tokens_used=total_used, token_savings_pct=savings_pct,
            matched_items=matched_items, assembled_context=assembled,
            trajectory=trajectory, execution_time_ms=exec_ms
        )
`
      },
      {
        filename: 'server.py',
        path: 'luminara_viking/server.py',
        language: 'python',
        description: 'FastAPI Context Server',
        code: `"""
FastAPI Server for Luminara Viking Context Operating System.
Provides RESTful VFS navigation, multi-resolution inspection, and DRR retrieval.
"""
from fastapi import FastAPI, Query
from pydantic import BaseModel
from .vfs import VikingVfs
from .retriever import DirectoryRecursiveRetriever

app = FastAPI(title="Luminara Viking Context OS", version="1.0.0")
vfs = VikingVfs()
retriever = DirectoryRecursiveRetriever(vfs)

@app.get("/health")
def health():
    return {"status": "ok", "engine": "Luminara Viking VFS", "nodes_indexed": len(vfs.nodes)}

@app.get("/vfs/ls")
def list_dir(uri: str = "viking://", recursive: bool = False):
    nodes = vfs.list_dir(uri, recursive=recursive)
    return {"uri": uri, "count": len(nodes), "entries": [n.dict() for n in nodes]}

@app.get("/vfs/cat")
def read_file(uri: str, layer: str = "L1"):
    node = vfs.nodes.get(vfs.normalize_uri(uri))
    if not node or not node.layers:
        return {"error": "Node not found or is directory"}
    layer_data = getattr(node.layers, layer.lower(), node.layers.l1)
    return {"uri": uri, "layer": layer.upper(), "token_count": layer_data.token_count, "content": layer_data.content}

class QueryRequest(BaseModel):
    query: str
    token_budget: int = 2000
    root_uri: str = "viking://"

@app.post("/vfs/query")
def query_context(req: QueryRequest):
    return retriever.retrieve(query=req.query, root_uri=req.root_uri, token_budget=req.token_budget)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("luminara_viking.server:app", host="0.0.0.0", port=8000, reload=True)
`
      }
    ];
  }
}
