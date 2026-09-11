const NODE_WIDTH = 230;
const NODE_HEIGHT = 34;
const ROW_GAP = 8;
const COLUMN_GAP = 70;
const LABEL_MAX_CHARACTERS = 30;
const LABEL_OFFSET_X = 10;
const LABEL_OFFSET_Y = 4;
const COUNT_OFFSET_X = NODE_WIDTH - 10;
const EXPANDER_RADIUS = 9;
const EXPANDER_TEXT_OFFSET_Y = 3.5;
const FIT_PADDING = 40;
const MAX_FIT_SCALE = 1.4;
const ZOOM_EXTENT = [0.05, 3];
const ELLIPSIS = '…';
const EXPANDED_SYMBOL = '−';
const COLLAPSED_SYMBOL = '+';
const CYCLE_MARKER = 'cycle';
const BUBBLE_RADIUS = 9;
const BUBBLE_SPACING = 22;
const BUBBLE_FIRST_OFFSET_X = NODE_WIDTH - 12;
const BUBBLE_TEXT_OFFSET_Y = 3.5;

const zoomBehaviours = new WeakMap();

const truncate = (text) =>
  text.length > LABEL_MAX_CHARACTERS ? `${text.slice(0, LABEL_MAX_CHARACTERS - 1)}${ELLIPSIS}` : text;

const positionKey = (treeNode) =>
  treeNode
    .ancestors()
    .map((ancestor) => ancestor.data.iri)
    .join(' > ');

const hasChildren = (treeNode) => treeNode.data.children.length > 0;

const ensureViewport = (svg) => {
  const existing = svg.select('g.viewport');
  return existing.empty() ? svg.append('g').attr('class', 'viewport') : existing;
};

const ensureZoom = (svgElement, svg, viewport) => {
  if (zoomBehaviours.has(svgElement)) {
    return zoomBehaviours.get(svgElement);
  }
  const zoom = d3
    .zoom()
    .scaleExtent(ZOOM_EXTENT)
    .on('zoom', (event) => viewport.attr('transform', event.transform));
  svg.call(zoom);
  zoomBehaviours.set(svgElement, zoom);
  return zoom;
};

const classesFor = (treeNode, selectedIri, pathIris) =>
  ['node', treeNode.data.iri === selectedIri && 'selected', pathIris.has(treeNode.data.iri) && 'on-path']
    .filter(Boolean)
    .join(' ');

const severityClass = (severity) => (severity === undefined ? '' : `severity-${severity}`);

const enterNode = (enter) => {
  const group = enter.append('g');
  group.append('rect');
  group.append('title');
  group.append('text').attr('class', 'label');
  group.append('text').attr('class', 'count');
  group.append('g').attr('class', 'bubbles');
  const expander = group.append('g').attr('class', 'expander');
  expander.append('circle').attr('r', EXPANDER_RADIUS);
  expander.append('text').attr('y', EXPANDER_TEXT_OFFSET_Y);
  return group;
};

const layoutTree = (hierarchyRoot, expanded) => {
  const root = d3.hierarchy(hierarchyRoot, (datum) => (expanded.has(datum.iri) ? datum.children : null));
  d3.tree().nodeSize([NODE_HEIGHT + ROW_GAP, NODE_WIDTH + COLUMN_GAP])(root);
  return root;
};

const linkShape = d3
  .linkHorizontal()
  .x((point) => point.y)
  .y((point) => point.x);

const renderLinks = (viewport, root, pathIris) =>
  viewport
    .selectAll('path.link')
    .data(root.links(), (link) => positionKey(link.target))
    .join('path')
    .attr('class', (link) =>
      pathIris.has(link.source.data.iri) && pathIris.has(link.target.data.iri) ? 'link on-path' : 'link',
    )
    .attr('d', (link) => linkShape({ source: { x: link.source.x, y: link.source.y + NODE_WIDTH }, target: link.target }));

const renderBoxes = (nodes, { expanded, labelOf, severityOf, onSelect }) => {
  nodes
    .select('rect')
    .attr('x', 0)
    .attr('y', -NODE_HEIGHT / 2)
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('class', (treeNode) => severityClass(severityOf(treeNode.data.iri)))
    .on('click', (event, treeNode) => onSelect(treeNode.data.iri));
  nodes.select('title').text((treeNode) => labelOf(treeNode.data.iri));
  nodes
    .select('text.label')
    .attr('x', LABEL_OFFSET_X)
    .attr('y', LABEL_OFFSET_Y)
    .text((treeNode) => truncate(labelOf(treeNode.data.iri)));
  nodes
    .select('text.count')
    .attr('x', COUNT_OFFSET_X)
    .attr('y', LABEL_OFFSET_Y)
    .attr('text-anchor', 'end')
    .attr('class', (treeNode) => (treeNode.data.truncatedCycle ? 'count cycle-marker' : 'count'))
    .text((treeNode) => collapsedCountText(treeNode, expanded));
};

const collapsedCountText = (treeNode, expanded) => {
  if (treeNode.data.truncatedCycle) {
    return CYCLE_MARKER;
  }
  return hasChildren(treeNode) && !expanded.has(treeNode.data.iri) ? String(treeNode.data.descendantCount) : '';
};

const enterBubble = (enter) => {
  const bubble = enter.append('g');
  bubble.append('circle').attr('r', BUBBLE_RADIUS);
  bubble.append('text').attr('y', BUBBLE_TEXT_OFFSET_Y);
  return bubble;
};

const renderBubbles = (nodes, bubblesOf) =>
  nodes
    .select('g.bubbles')
    .attr('transform', `translate(0,${-NODE_HEIGHT / 2})`)
    .selectAll('g.bubble')
    .data((treeNode) => bubblesOf(treeNode.data.iri), (bubble) => bubble.severity)
    .join(enterBubble)
    .attr('class', (bubble) => `bubble severity-${bubble.severity}`)
    .attr('transform', (bubble, index) => `translate(${BUBBLE_FIRST_OFFSET_X - index * BUBBLE_SPACING},0)`)
    .select('text')
    .text((bubble) => String(bubble.count));

const renderExpanders = (nodes, expanded, onToggle) =>
  nodes
    .select('g.expander')
    .attr('display', (treeNode) => (hasChildren(treeNode) ? null : 'none'))
    .attr('transform', `translate(${NODE_WIDTH},0)`)
    .on('click', (event, treeNode) => {
      event.stopPropagation();
      onToggle(treeNode.data.iri);
    })
    .select('text')
    .text((treeNode) => (expanded.has(treeNode.data.iri) ? EXPANDED_SYMBOL : COLLAPSED_SYMBOL));

/**
 * Draws a collapsible, horizontal organisation chart into the SVG. Re-rendering with new options
 * updates the drawing in place and keeps the viewer's zoom and pan. Each node shows the bubbles
 * returned by bubblesOf, one per severity with a count of findings below the unit.
 */
export const renderChart = (svgElement, hierarchyRoot, options) => {
  const { expanded, selectedIri, pathIris, bubblesOf, onToggle } = options;
  const svg = d3.select(svgElement);
  const viewport = ensureViewport(svg);
  ensureZoom(svgElement, svg, viewport);
  const root = layoutTree(hierarchyRoot, expanded);
  renderLinks(viewport, root, pathIris);
  const nodes = viewport
    .selectAll('g.node')
    .data(root.descendants(), positionKey)
    .join(enterNode)
    .attr('class', (treeNode) => classesFor(treeNode, selectedIri, pathIris))
    .attr('transform', (treeNode) => `translate(${treeNode.y},${treeNode.x})`);
  renderBoxes(nodes, options);
  renderBubbles(nodes, bubblesOf);
  renderExpanders(nodes, expanded, onToggle);
};

/** Pans and zooms so that everything currently drawn is visible. */
export const fitChart = (svgElement) => {
  const zoom = zoomBehaviours.get(svgElement);
  const viewport = svgElement.querySelector('g.viewport');
  if (!zoom || !viewport) {
    return;
  }
  const bounds = viewport.getBBox();
  const { width, height } = svgElement.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0 || width === 0 || height === 0) {
    return;
  }
  const scale = Math.min(
    MAX_FIT_SCALE,
    (width - FIT_PADDING) / bounds.width,
    (height - FIT_PADDING) / bounds.height,
  );
  const translateX = (width - bounds.width * scale) / 2 - bounds.x * scale;
  const translateY = (height - bounds.height * scale) / 2 - bounds.y * scale;
  d3.select(svgElement).call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
};
