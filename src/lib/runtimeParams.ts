import type { GraphModel, Parameter } from "./graphModel";

// One parameter a running node actually declares, as reported by `ros2 param list`.
// This is the ground truth for which node owns which parameter — static analysis
// cannot know it, because shared `/**` param files are loaded by many nodes.
export type RuntimeDeclaredParam = {
  nodeName: string;
  paramName: string;
  value: string | number | boolean | null;
  parameterType: string;
  readOnly: boolean;
};

function declaredParamsByNode(params: RuntimeDeclaredParam[]): Map<string, Map<string, RuntimeDeclaredParam>> {
  const byNode = new Map<string, Map<string, RuntimeDeclaredParam>>();
  for (const param of params) {
    let forNode = byNode.get(param.nodeName);
    if (!forNode) {
      forNode = new Map();
      byNode.set(param.nodeName, forNode);
    }
    if (!forNode.has(param.paramName)) forNode.set(param.paramName, param);
  }
  return byNode;
}

// Inline params (`<param name=.. value=..>` written directly on the node in the
// launch XML) are unambiguously owned by that node, so they are never filtered.
// Only params pulled from a shared param file (`<param from=..yaml>`) can be
// over-attributed across nodes via a `/**` wildcard, so only those are checked
// against the runtime declaration.
function isSharedFileParam(param: Parameter): boolean {
  return /\.ya?ml$/i.test(param.sourceFile);
}

function runtimeParamToParameter(nodeName: string, declared: RuntimeDeclaredParam): Parameter {
  return {
    nodeId: nodeName,
    nodeName,
    key: declared.paramName,
    value: declared.value,
    sourceFile: "runtime",
    dirty: false,
    dynamic: true,
    parameterType: declared.parameterType,
    readOnly: declared.readOnly
  };
}

// Reconcile statically-discovered parameters with the parameters a node actually
// declares at runtime. Static analysis over-attributes parameters from shared
// `/**` files (e.g. common.param.yaml's max_vel) to every node that loads the
// file, even nodes that never declare them. Using the runtime declaration as the
// source of truth, we keep a static parameter only on nodes that truly own it,
// and surface any remaining runtime-only parameters as dynamic entries.
//
// When a node has no runtime declaration data (it was not scanned, or the query
// failed) we leave its static parameters untouched — hiding nothing we are
// unsure about. This is generic: it works for every node and parameter, not just
// the common-config case that motivated it.
export function reconcileRuntimeParameters(graph: GraphModel, runtimeParams: RuntimeDeclaredParam[]): GraphModel {
  const declaredByNode = declaredParamsByNode(runtimeParams);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const staticParams = node.params.filter((param) => !param.dynamic);
      const declared = declaredByNode.get(node.name);

      // No runtime truth for this node: keep its static params, drop stale dynamics.
      if (!declared) return { ...node, params: staticParams };

      const keptStatic = staticParams
        // Keep inline params always; keep shared-file params only when the node
        // actually declares them at runtime.
        .filter((param) => !isSharedFileParam(param) || declared.has(param.key))
        .map((param) => {
          const match = declared.get(param.key);
          return match
            ? {
                ...param,
                parameterType: param.parameterType ?? match.parameterType,
                readOnly: param.readOnly ?? match.readOnly
              }
            : param;
        });
      const coveredKeys = new Set(keptStatic.map((param) => param.key));
      const runtimeOnly = [...declared.values()]
        .filter((declaredParam) => !coveredKeys.has(declaredParam.paramName))
        .map((declaredParam) => runtimeParamToParameter(node.name, declaredParam));

      return { ...node, params: [...keptStatic, ...runtimeOnly] };
    })
  };
}
