import { registerRoot } from "remotion";
import { installAssetShim } from "./lib/asset-shim";
import { Root } from "./Root";

installAssetShim();
registerRoot(Root);
