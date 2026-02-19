import json
import os
from typing import Dict, List, Any
from ai_adapter import create_ai_adapter, AIAdapter
from utils import extract_text_from_pdf
from prompt_templates import PromptTemplates

class KnowledgeGraphGenerator:
    def __init__(self, ai_provider: str = "auto"):
        """
        Initialize Knowledge Graph Generator with AI provider support
        
        Args:
            ai_provider: "gemini", "openai", or "auto" for automatic detection
        """
        try:
            self.ai = create_ai_adapter(ai_provider)
            provider_info = self.ai.get_provider_info()
            print(f"🧠 Knowledge Graph Generator initialized with {provider_info['provider']} (Content: {provider_info['content_model']}, Search: {provider_info['search_model']})")
        except Exception as e:
            print(f"❌ Failed to initialize AI provider: {e}")
            raise
    
    def extract_knowledge_graph_from_text(self, text: str) -> Dict[str, Any]:
        """Extract entities and relationships from text using centralized AI prompts"""
        
        # Use centralized prompt template with knowledge graph context
        prompt = PromptTemplates.get_resume_analysis_prompt(text, context="knowledge_graph")
        
        try:
            response_text = self.ai.generate_content(prompt)
            
            # Extract JSON from response
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1
            
            if start_idx != -1 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                knowledge_graph = json.loads(json_str)
                
                # Validate and clean entity types to reduce "other" classifications
                knowledge_graph = self._validate_and_clean_entities(knowledge_graph)
                
                print(f"✅ Extracted {len(knowledge_graph.get('entities', []))} entities and {len(knowledge_graph.get('relationships', []))} relationships")
                return knowledge_graph
            else:
                print("❌ Could not extract JSON from AI response")
                return self.get_default_knowledge_graph()
                
        except Exception as e:
            print(f"❌ Error extracting knowledge graph: {e}")
            return self.get_default_knowledge_graph()
    
    def _validate_and_clean_entities(self, knowledge_graph: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and clean entity types to reduce 'other' classifications"""
        
        # Define valid entity types
        valid_types = {
            'person', 'skill', 'knowledge', 'tool', 'qualification', 
            'role', 'workplace', 'methodology'
        }
        
        # Type mapping for common variations
        type_mappings = {
            'technology': 'tool',
            'software': 'tool', 
            'platform': 'tool',
            'framework': 'tool',
            'programming_language': 'skill',
            'language': 'skill',
            'certification': 'qualification',
            'degree': 'qualification',
            'education': 'qualification',
            'company': 'workplace',
            'organization': 'workplace',
            'institution': 'workplace',
            'university': 'workplace',
            'school': 'workplace',
            'position': 'role',
            'job': 'role',
            'title': 'role',
            'method': 'methodology',
            'approach': 'methodology',
            'process': 'methodology',
            'expertise': 'knowledge',
            'domain': 'knowledge',
            'field': 'knowledge',
            'specialization': 'knowledge',
            'specialty': 'knowledge',
            'ability': 'skill',
            'competency': 'skill',
            'proficiency': 'skill'
        }
        
        if 'entities' in knowledge_graph:
            cleaned_entities = []
            for entity in knowledge_graph['entities']:
                if 'type' in entity:
                    original_type = entity['type'].lower().strip()
                    
                    # Map to valid type if possible
                    if original_type in type_mappings:
                        entity['type'] = type_mappings[original_type]
                        print(f"🔄 Mapped entity type '{original_type}' → '{entity['type']}'")
                    elif original_type not in valid_types:
                        # Use AI to intelligently classify unknown types
                        new_type = self._classify_entity_with_ai(entity)
                        if new_type and new_type in valid_types:
                            entity['type'] = new_type
                            print(f"🤖 AI classified '{original_type}' → '{new_type}'")
                        else:
                            # Fallback: make educated guess based on name/description
                            entity['type'] = self._guess_entity_type(entity)
                            print(f"🔍 Guessed entity type '{original_type}' → '{entity['type']}'")
                
                cleaned_entities.append(entity)
            
            knowledge_graph['entities'] = cleaned_entities
        
        return knowledge_graph
    
    def _classify_entity_with_ai(self, entity: Dict[str, Any]) -> str:
        """Use AI to classify entities that don't match standard types"""
        try:
            prompt = f"""
            Classify this entity into one of these specific types:
            - person: The individual
            - skill: Technical and professional skills
            - knowledge: Domain expertise and specialized knowledge areas  
            - tool: Software, platforms, frameworks, databases, instruments
            - qualification: Degrees, certifications, licenses
            - role: Job titles and professional positions
            - workplace: Companies, organizations, institutions
            - methodology: Processes, methodologies, approaches
            
            Entity to classify:
            Name: {entity.get('name', '')}
            Current Type: {entity.get('type', '')}
            Description: {entity.get('description', '')}
            
            Respond with only one word: the correct type from the list above.
            """
            
            response = self.ai.generate_content(prompt)
            classified_type = response.strip().lower()
            
            valid_types = {'person', 'skill', 'knowledge', 'tool', 'qualification', 'role', 'workplace', 'methodology'}
            return classified_type if classified_type in valid_types else None
            
        except Exception as e:
            print(f"⚠️ AI classification failed for entity {entity.get('name', 'unknown')}: {e}")
            return None
    
    def _guess_entity_type(self, entity: Dict[str, Any]) -> str:
        """Make an educated guess about entity type based on patterns"""
        name = entity.get('name', '').lower()
        description = entity.get('description', '').lower()
        
        # Pattern-based classification
        if any(word in name for word in ['university', 'college', 'school', 'company', 'corp', 'inc', 'organization']):
            return 'workplace'
        elif any(word in name for word in ['degree', 'bachelor', 'master', 'phd', 'certification', 'license', 'certified']):
            return 'qualification'
        elif any(word in name for word in ['manager', 'director', 'analyst', 'engineer', 'developer', 'specialist', 'coordinator']):
            return 'role'
        elif any(word in name for word in ['software', 'system', 'platform', 'tool', 'application', 'database']):
            return 'tool'
        elif any(word in description for word in ['knowledge', 'expertise', 'understanding', 'domain', 'field']):
            return 'knowledge'
        elif any(word in description for word in ['method', 'approach', 'process', 'methodology', 'framework']):
            return 'methodology'
        else:
            return 'skill'  # Default fallback
    
    def get_default_knowledge_graph(self) -> Dict[str, Any]:
        """Return a generic default knowledge graph for fallback"""
        return {
            "entities": [
                {
                    "id": "candidate", 
                    "name": "Professional Candidate", 
                    "type": "person", 
                    "importance": 10.0, 
                    "description": "Experienced professional seeking new opportunities", 
                    "attributes": {"role": "Professional", "experience": "Multi-year experience"}
                },
                {
                    "id": "communication", 
                    "name": "Communication Skills", 
                    "type": "skill", 
                    "importance": 9.0, 
                    "description": "Strong verbal and written communication abilities", 
                    "attributes": {"proficiency": "Advanced", "relevance_to_field": "High"}
                },
                {
                    "id": "problem_solving", 
                    "name": "Problem Solving", 
                    "type": "skill", 
                    "importance": 8.5, 
                    "description": "Analytical thinking and solution-oriented approach", 
                    "attributes": {"proficiency": "Advanced", "relevance_to_field": "High"}
                },
                {
                    "id": "teamwork", 
                    "name": "Teamwork & Collaboration", 
                    "type": "skill", 
                    "importance": 8.0, 
                    "description": "Ability to work effectively in team environments", 
                    "attributes": {"proficiency": "Advanced", "relevance_to_field": "High"}
                },
                {
                    "id": "organization", 
                    "name": "Organization & Planning", 
                    "type": "skill", 
                    "importance": 7.5, 
                    "description": "Strong organizational and time management skills", 
                    "attributes": {"proficiency": "Advanced", "relevance_to_field": "Medium"}
                }
            ],
            "relationships": [
                {"source": "candidate", "target": "communication", "type": "has_skill", "strength": 9.0, "description": "Demonstrates strong communication in professional settings"},
                {"source": "candidate", "target": "problem_solving", "type": "has_skill", "strength": 8.5, "description": "Applies analytical thinking to solve workplace challenges"},
                {"source": "candidate", "target": "teamwork", "type": "has_skill", "strength": 8.0, "description": "Collaborates effectively with colleagues and stakeholders"},
                {"source": "candidate", "target": "organization", "type": "has_skill", "strength": 7.5, "description": "Manages tasks and priorities efficiently"}
            ],
            "summary": "Multi-skilled professional with strong foundational skills applicable across various industries and roles"
        }
    
    def generate_interactive_visualization(self, knowledge_graph: Dict[str, Any], output_file: str = "knowledge_graph.html") -> str:
        """Generate an interactive HTML visualization of the knowledge graph with LinkedIn styling"""
        
        entities = knowledge_graph.get('entities', [])
        relationships = knowledge_graph.get('relationships', [])
        summary = knowledge_graph.get('summary', 'Professional Knowledge Graph')
        
        # Define valid entity types (updated to match prompt_templates.py)
        valid_types = {'person', 'skill', 'knowledge', 'tool', 'qualification', 'role', 'workplace', 'methodology'}
        
        # No longer force entities to 'other' - trust the AI classification from updated prompts
        # The AI should now properly classify entities using the improved prompts
        
        # Updated LinkedIn-style color mapping (matching HTML and prompt_templates.py)
        color_map = {
            'person': '#0A66C2',      # LinkedIn Blue
            'skill': '#057642',       # Green for skills
            'knowledge': '#FF8C00',   # Orange for knowledge domains
            'tool': '#6441A4',        # Purple for tools and software
            'qualification': '#1B6EC8',# Blue for qualifications and education
            'role': '#8B5A3C',       # Brown for roles
            'workplace': '#2D3748',   # Dark gray for workplaces and companies
            'methodology': '#9B59B6', # Purple for methodologies
            'other': '#5A6C7D',       # Gray for any remaining unclassified (should be rare now)
            'default': '#5A6C7D'      # Default gray for unknown types
        }
        
        html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Professional Knowledge Graph</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
            background: #F4F2EE;
            color: #000000;
            line-height: 1.6;
            overflow-x: auto;
        }}
        
        .linkedin-header {{
            background: #FFFFFF;
            border-bottom: 1px solid #E6E6E6;
            padding: 15px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.08);
        }}
        
        .container {{
            max-width: 1600px; /* Increased from 1200px to 1600px */
            margin: 0 auto;
            padding: 0 20px;
        }}
        
        .header-content {{
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}
        
        .logo-section {{
            display: flex;
            align-items: center;
            gap: 15px;
        }}
        
        .linkedin-logo {{
            width: 40px;
            height: 40px;
            background: #0A66C2;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 18px;
        }}
        
        .title {{
            font-size: 24px;
            font-weight: 600;
            color: #000000;
        }}
        
        .subtitle {{
            color: #666666;
            font-size: 14px;
            margin-top: 4px;
        }}
        
        .main-content {{
            background: #FFFFFF;
            margin: 20px auto;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            overflow: hidden;
        }}
        
        .content-header {{
            padding: 16px 24px; /* Reduced vertical padding from 24px to 16px */
            border-bottom: 1px solid #E6E6E6;
            background: #FAFAFA;
        }}
        
        .summary {{
            font-size: 16px;
            color: #333333;
            margin-bottom: 20px;
        }}
        
        .controls {{
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }}
        
                 .linkedin-btn {{
             background: #0A66C2;
             color: white;
             border: none;
             padding: 8px 16px;
             border-radius: 4px;
             font-size: 14px;
             font-weight: 500;
             cursor: pointer;
             transition: all 0.2s ease;
             text-transform: none;
             letter-spacing: 0;
         }}
        
        .linkedin-btn:hover {{
            background: #084A8A;
            transform: translateY(-1px);
        }}
        
        .linkedin-btn.secondary {{
            background: #FFFFFF;
            color: #0A66C2;
            border: 1px solid #0A66C2;
        }}
        
        .linkedin-btn.secondary:hover {{
            background: #F1F5F9;
        }}
        
        .legend {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 12px;
            margin-top: 20px;
        }}
        
                 .legend-item {{
             display: flex;
             align-items: center;
             gap: 8px;
             padding: 8px 12px;
             background: #FFFFFF;
             border: 1px solid #E6E6E6;
             border-radius: 6px;
             font-size: 13px;
             font-weight: 500;
             cursor: pointer;
             transition: all 0.2s ease;
             user-select: none;
         }}
         
         .legend-item:hover {{
             background: #F8F9FA;
             border-color: #0A66C2;
             transform: translateY(-1px);
         }}
         
         .legend-item.active {{
             background: #E7F3FF;
             border-color: #0A66C2;
             color: #0A66C2;
             font-weight: 600;
         }}
         
         .legend-item.inactive {{
             background: #F5F5F5;
             border-color: #CCCCCC;
             color: #999999;
             opacity: 0.6;
         }}
        
        .legend-color {{
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }}
        
                          .graph-container {{
             position: relative;
             padding: 10px; /* Reduced from 20px to 10px */
             display: flex;
             justify-content: center;
             align-items: center;
             min-height: 850px; /* Added minimum height */
             width: 100%;
             overflow: hidden;
         }}
         
         #graph {{
             background: #FFFFFF;
             display: block;
             border: 1px solid #E6E6E6;
             border-radius: 8px;
             margin: 0 auto;
         }}
        
        .info-panel {{
            position: fixed;
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
            background: #FFFFFF;
            border: 1px solid #E6E6E6;
            border-radius: 12px;
            padding: 20px;
            max-width: 320px;
            min-width: 280px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            display: none;
            z-index: 1000;
            max-height: 70vh;
            overflow-y: auto;
        }}
        
        .info-panel h3 {{
            color: #0A66C2;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 2px solid #E6E6E6;
        }}
        
        .info-item {{
            margin-bottom: 12px;
        }}
        
        .info-label {{
            font-weight: 600;
            color: #333333;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }}
        
        .info-value {{
            color: #666666;
            font-size: 14px;
            line-height: 1.4;
        }}
        
        .close-btn {{
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #666666;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
        }}
        
        .close-btn:hover {{
            background: #F1F5F9;
            color: #333333;
        }}
        
        .node-tooltip {{
            position: absolute;
            background: #333333;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            pointer-events: none;
            z-index: 1000;
            max-width: 200px;
            word-wrap: break-word;
        }}
        
        .stats-panel {{
            padding: 12px 24px; /* Reduced vertical padding from 16px to 12px */
            background: #F8F9FA;
            border-bottom: 1px solid #E6E6E6;
            display: flex;
            justify-content: space-around;
            text-align: center;
        }}
        
        .stat-item {{
            flex: 1;
        }}
        
        .stat-number {{
            font-size: 24px;
            font-weight: 700;
            color: #0A66C2;
            display: block;
        }}
        
                 .stat-label {{
             font-size: 12px;
             color: #666666;
             font-weight: 500;
             text-transform: uppercase;
             letter-spacing: 0.5px;
         }}
         
         kbd {{
             background: #F1F5F9;
             border: 1px solid #C4CDD5;
             border-radius: 3px;
             padding: 2px 6px;
             font-size: 12px;
             font-family: monospace;
             color: #333333;
         }}
        
        @media (max-width: 768px) {{
            .header-content {{
                flex-direction: column;
                align-items: flex-start;
                gap: 15px;
            }}
            
            .controls {{
                width: 100%;
            }}
            
            .legend {{
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            }}
            
            .info-panel {{
                position: fixed;
                top: 20px;
                left: 20px;
                right: 20px;
                transform: none;
                max-width: none;
                max-height: 60vh;
            }}
        }}
    </style>
</head>
<body>
    <div class="linkedin-header">
        <div class="container">
            <div class="header-content">
                <div class="logo-section">
                    <div class="linkedin-logo">in</div>
                    <div>
                        <div class="title">Professional Knowledge Graph</div>
                        <div class="subtitle">Skills & Competencies Visualization</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="main-content">
            <div class="stats-panel">
                <div class="stat-item">
                    <span class="stat-number" id="nodeCount">{len(entities)}</span>
                    <span class="stat-label">Skills & Entities</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number" id="linkCount">{len(relationships)}</span>
                    <span class="stat-label">Connections</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number" id="skillCount">-</span>
                    <span class="stat-label">Core Skills</span>
                </div>
            </div>
            
                         <div class="content-header">
                 <div class="summary">{summary}</div>
                 
                 <div style="background: #E7F3FF; padding: 12px; border-radius: 8px; margin: 15px 0; font-size: 14px; color: #0A66C2;">
                     <strong>Interactive Controls:</strong> Click category badges below to filter by type. Hold <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on Mac) for multi-select. Use mouse wheel to zoom in/out and drag to pan.
                 </div>
                 
                                  <div class="controls">
                     <button class="linkedin-btn" onclick="restartSimulation()">
                         Reset Layout
                     </button>
                     <button class="linkedin-btn secondary" onclick="centerGraph()">
                         Center View
                     </button>
                     <button class="linkedin-btn secondary" onclick="zoomIn()">
                         Zoom In
                     </button>
                     <button class="linkedin-btn secondary" onclick="zoomOut()">
                         Zoom Out
                     </button>
                     <button class="linkedin-btn secondary" onclick="resetZoom()">
                         Reset Zoom
                     </button>
                     <button class="linkedin-btn secondary" onclick="toggleLabels()">
                         Toggle Labels
                     </button>
                     <button class="linkedin-btn secondary" onclick="showAllTypes()">
                         Show All
                     </button>
                     <button class="linkedin-btn secondary" onclick="exportGraph()">
                         Export Data
                     </button>
                 </div>
                
                                 <div class="legend">
                     <div class="legend-item active" data-type="person" onclick="toggleFilter('person', event)">
                         <div class="legend-color" style="background-color: {color_map['person']};"></div>
                         <span>Person</span>
                     </div>
                     <div class="legend-item active" data-type="skill" onclick="toggleFilter('skill', event)">
                         <div class="legend-color" style="background-color: {color_map['skill']};"></div>
                         <span>Skills</span>
                     </div>
                     <div class="legend-item active" data-type="tool" onclick="toggleFilter('tool', event)">
                         <div class="legend-color" style="background-color: {color_map['tool']};"></div>
                         <span>Tools</span>
                     </div>
                     <div class="legend-item active" data-type="knowledge" onclick="toggleFilter('knowledge', event)">
                         <div class="legend-color" style="background-color: {color_map['knowledge']};"></div>
                         <span>Knowledge</span>
                     </div>
                     <div class="legend-item active" data-type="qualification" onclick="toggleFilter('qualification', event)">
                         <div class="legend-color" style="background-color: {color_map['qualification']};"></div>
                         <span>Qualifications</span>
                     </div>
                     <div class="legend-item active" data-type="role" onclick="toggleFilter('role', event)">
                         <div class="legend-color" style="background-color: {color_map['role']};"></div>
                         <span>Roles</span>
                     </div>
                     <div class="legend-item active" data-type="workplace" onclick="toggleFilter('workplace', event)">
                         <div class="legend-color" style="background-color: {color_map['workplace']};"></div>
                         <span>Workplace</span>
                     </div>
                     <div class="legend-item active" data-type="methodology" onclick="toggleFilter('methodology', event)">
                         <div class="legend-color" style="background-color: {color_map['methodology']};"></div>
                         <span>Methodology</span>
                     </div>
                     <div class="legend-item active" data-type="other" onclick="toggleFilter('other', event)">
                         <div class="legend-color" style="background-color: {color_map['other']};"></div>
                         <span>Other</span>
                     </div>
                 </div>
            </div>
            
            <div class="graph-container">
                <svg id="graph"></svg>
            </div>
        </div>
    </div>
    
    <div class="info-panel" id="infoPanel">
        <button class="close-btn" onclick="closeInfoPanel()">×</button>
        <h3 id="infoTitle">Node Information</h3>
        <div id="nodeDetails"></div>
    </div>
    
    <div class="node-tooltip" id="tooltip"></div>

    <script>
        // Data from Python
        const entities = {json.dumps(entities, indent=2)};
        const relationships = {json.dumps(relationships, indent=2)};
        const colorMap = {json.dumps(color_map, indent=2)};
        
        // Filter state management
        let activeFilters = new Set(['person', 'skill', 'tool', 'knowledge', 'qualification', 'role', 'workplace', 'methodology', 'other']);
        let isMultiSelect = false;
        
        // Graph setup
        const containerWidth = document.querySelector('.graph-container').offsetWidth;
        const width = Math.min(containerWidth * 0.98, 1400); // Increased from 1100 to 1400
        const height = 800; // Increased from 600 to 800
        
        const svg = d3.select("#graph")
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", `0 0 ${{width}} ${{height}}`)
            .style("max-width", "100%")
            .style("height", "auto");
        
        // Add zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.3, 3]) // Allow zoom from 30% to 300%
            .on("zoom", (event) => {{
                const {{transform}} = event;
                g.attr("transform", transform);
            }});
        
        svg.call(zoom);
        
        // Create a group for all graph elements (this will be transformed by zoom)
        const g = svg.append("g");
        
        // Create graph data structure
        const centerX = width / 2;
        const centerY = height / 2;
        
        const nodes = entities.map(e => ({{
            id: e.id,
            name: e.name,
            type: e.type,
            importance: e.importance,
            description: e.description,
            attributes: e.attributes || {{}},
            x: centerX + (Math.random() - 0.5) * 150,
            y: centerY + (Math.random() - 0.5) * 150
        }}));
        
        const links = relationships.map(r => ({{
            source: r.source,
            target: r.target,
            type: r.type,
            strength: r.strength,
            description: r.description
        }}));
        
        // Update skill count
        const skillCount = nodes.filter(n => n.type === 'skill').length;
        document.getElementById('skillCount').textContent = skillCount;
        
        // Create simulation
        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(d => 80 + (10 - d.strength) * 15))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(centerX, centerY))
            .force("collision", d3.forceCollide().radius(d => Math.sqrt(d.importance) * 4 + 15)) // Original collision radius
            .force("x", d3.forceX(centerX).strength(0.15))
            .force("y", d3.forceY(centerY).strength(0.15));
        
        // Create link elements
        const link = g.append("g")
            .selectAll("line")
            .data(links)
            .enter().append("line")
            .attr("stroke", "#C4CDD5")
            .attr("stroke-opacity", d => 0.3 + (d.strength / 10) * 0.7)
            .attr("stroke-width", d => 1 + Math.sqrt(d.strength))
            .on("mouseover", function(event, d) {{
                showTooltip(event, `${{d.type}}: ${{d.description}}<br>Strength: ${{d.strength}}/10`);
            }})
            .on("mouseout", hideTooltip);
        
        // Create node elements
        const node = g.append("g")
            .selectAll("circle")
            .data(nodes)
            .enter().append("circle")
            .attr("r", d => Math.sqrt(d.importance) * 4 + 10) // Original node radius
            .attr("fill", d => colorMap[d.type] || colorMap.default)
            .attr("stroke", "#FFFFFF")
            .attr("stroke-width", 2)
            .style("cursor", "pointer")
            .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.15))")
            .on("mouseover", function(event, d) {{
                d3.select(this).transition().duration(200)
                    .attr("r", Math.sqrt(d.importance) * 5 + 14)
                    .style("filter", "drop-shadow(0 4px 12px rgba(0,0,0,0.25))");
                showTooltip(event, `<strong>${{d.name}}</strong><br>${{d.type}} • Importance: ${{d.importance}}/10`);
            }})
            .on("mouseout", function(event, d) {{
                d3.select(this).transition().duration(200)
                    .attr("r", Math.sqrt(d.importance) * 4 + 10)
                    .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.15))");
                hideTooltip();
            }})
            .on("click", function(event, d) {{
                showNodeDetails(d);
            }})
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
        
        // Create labels
        const labels = g.append("g")
            .selectAll("text")
            .data(nodes)
            .enter().append("text")
            .text(d => d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name)
            .attr("font-size", d => Math.max(10, Math.sqrt(d.importance) * 1.5 + 8))
            .attr("fill", "#333333")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("dy", "0")
            .style("font-weight", "500")
            .style("pointer-events", "none")
            .style("text-shadow", "1px 1px 2px rgba(255,255,255,0.8)")
            .style("user-select", "none");
        
        // Update positions on simulation tick
        simulation.on("tick", () => {{
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            
            node
                .attr("cx", d => d.x)
                .attr("cy", d => d.y);
            
            labels
                .attr("x", d => d.x)
                .attr("y", d => d.y);
        }});
        
        // Filter toggle function
        function toggleFilter(type, event) {{
            isMultiSelect = event.ctrlKey || event.metaKey;
            
            if (!isMultiSelect) {{
                // Single select mode - clear all filters and select only this type
                activeFilters.clear();
                activeFilters.add(type);
                
                // Update legend visual state
                document.querySelectorAll('.legend-item').forEach(item => {{
                    if (item.dataset.type === type) {{
                        item.classList.add('active');
                        item.classList.remove('inactive');
                    }} else {{
                        item.classList.remove('active');
                        item.classList.add('inactive');
                    }}
                }});
            }} else {{
                // Multi-select mode - toggle this type
                const legendItem = document.querySelector(`.legend-item[data-type="${{type}}"]`);
                
                if (activeFilters.has(type)) {{
                    activeFilters.delete(type);
                    legendItem.classList.remove('active');
                    legendItem.classList.add('inactive');
                }} else {{
                    activeFilters.add(type);
                    legendItem.classList.add('active');
                    legendItem.classList.remove('inactive');
                }}
                
                // If no filters are active, activate all
                if (activeFilters.size === 0) {{
                    activeFilters = new Set(['person', 'skill', 'tool', 'knowledge', 'qualification', 'role', 'workplace', 'methodology', 'other']);
                    document.querySelectorAll('.legend-item').forEach(item => {{
                        item.classList.add('active');
                        item.classList.remove('inactive');
                    }});
                }}
            }}
            
            updateGraph();
        }}
        
        // Update graph based on active filters
        function updateGraph() {{
            // Filter nodes
            node.style("opacity", d => activeFilters.has(d.type) ? 1 : 0.1)
                .style("pointer-events", d => activeFilters.has(d.type) ? "all" : "none");
            
            // Filter labels
            labels.style("opacity", d => activeFilters.has(d.type) ? 1 : 0.1);
            
            // Filter links - show only if both source and target are visible
            link.style("opacity", d => {{
                const sourceNode = nodes.find(n => n.id === d.source.id || n.id === d.source);
                const targetNode = nodes.find(n => n.id === d.target.id || n.id === d.target);
                return (activeFilters.has(sourceNode.type) && activeFilters.has(targetNode.type)) ? 
                    (0.3 + (d.strength / 10) * 0.7) : 0.05;
            }})
            .style("pointer-events", d => {{
                const sourceNode = nodes.find(n => n.id === d.source.id || n.id === d.source);
                const targetNode = nodes.find(n => n.id === d.target.id || n.id === d.target);
                return (activeFilters.has(sourceNode.type) && activeFilters.has(targetNode.type)) ? "all" : "none";
            }});
            
            // Update statistics
            const visibleNodes = nodes.filter(n => activeFilters.has(n.type));
            const visibleSkills = visibleNodes.filter(n => n.type === 'skill');
            const visibleLinks = relationships.filter(r => {{
                const sourceNode = nodes.find(n => n.id === r.source);
                const targetNode = nodes.find(n => n.id === r.target);
                return activeFilters.has(sourceNode.type) && activeFilters.has(targetNode.type);
            }});
            
            document.getElementById('nodeCount').textContent = visibleNodes.length;
            document.getElementById('linkCount').textContent = visibleLinks.length;
            document.getElementById('skillCount').textContent = visibleSkills.length;
        }}
        
        // Show node details in side panel
        function showNodeDetails(node) {{
            const panel = document.getElementById('infoPanel');
            const title = document.getElementById('infoTitle');
            const details = document.getElementById('nodeDetails');
            
            title.textContent = node.name;
            
            let detailsHTML = `
                <div class="info-item">
                    <div class="info-label">Type</div>
                    <div class="info-value">${{node.type.charAt(0).toUpperCase() + node.type.slice(1)}}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Importance</div>
                    <div class="info-value">${{node.importance}}/10</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Description</div>
                    <div class="info-value">${{node.description}}</div>
                </div>
            `;
            
            // Add attributes if they exist
            if (node.attributes && Object.keys(node.attributes).length > 0) {{
                Object.entries(node.attributes).forEach(([key, value]) => {{
                    detailsHTML += `
                        <div class="info-item">
                            <div class="info-label">${{key.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase())}}</div>
                            <div class="info-value">${{value}}</div>
                        </div>
                    `;
                }});
            }}
            
            // Add related connections
            const relatedConnections = relationships.filter(r => r.source === node.id || r.target === node.id);
            if (relatedConnections.length > 0) {{
                detailsHTML += `
                    <div class="info-item">
                        <div class="info-label">Connections</div>
                        <div class="info-value">
                `;
                relatedConnections.forEach(conn => {{
                    const connectedNode = conn.source === node.id ? 
                        entities.find(e => e.id === conn.target) : 
                        entities.find(e => e.id === conn.source);
                    if (connectedNode) {{
                        detailsHTML += `• ${{connectedNode.name}} (${{conn.type}})<br>`;
                    }}
                }});
                detailsHTML += `</div></div>`;
            }}
            
            details.innerHTML = detailsHTML;
            panel.style.display = 'block';
        }}
        
        function closeInfoPanel() {{
            document.getElementById('infoPanel').style.display = 'none';
        }}
        
        // Tooltip functions
        function showTooltip(event, content) {{
            const tooltip = document.getElementById("tooltip");
            tooltip.innerHTML = content;
            tooltip.style.display = "block";
            tooltip.style.left = (event.pageX + 10) + "px";
            tooltip.style.top = (event.pageY + 10) + "px";
        }}
        
        function hideTooltip() {{
            document.getElementById("tooltip").style.display = "none";
        }}
        
        // Control functions
        function restartSimulation() {{
            // Only restart the physics simulation without affecting filters
            simulation.alpha(1).restart();
            
            // Ensure the current filter state is maintained
            setTimeout(() => {{
                updateGraph();
            }}, 100);
        }}
        
        function centerGraph() {{
            // Reset any fixed positions
            nodes.forEach(node => {{
                node.fx = null;
                node.fy = null;
            }});
            
            // Temporarily fix nodes near center
            nodes.forEach(node => {{
                node.fx = centerX + (Math.random() - 0.5) * 150;
                node.fy = centerY + (Math.random() - 0.5) * 150;
            }});
            
            // Restart simulation with higher alpha for faster convergence
            simulation.alpha(0.8).alphaTarget(0).restart();
            
            // Release fixed positions after animation
            setTimeout(() => {{
                nodes.forEach(node => {{
                    node.fx = null;
                    node.fy = null;
                }});
                simulation.alphaTarget(0);
                
                // Maintain current filter state after centering
                updateGraph();
            }}, 1000);
        }}
        
        let labelsVisible = true;
        function toggleLabels() {{
            labelsVisible = !labelsVisible;
            if (labelsVisible) {{
                labels.style("opacity", d => activeFilters.has(d.type) ? 1 : 0.1);
            }} else {{
                labels.style("opacity", 0);
            }}
        }}
        
        function showAllTypes() {{
            // Reset all filters to active
            activeFilters = new Set(['person', 'skill', 'tool', 'knowledge', 'qualification', 'role', 'workplace', 'methodology', 'other']);
            
            // Update legend visual state
            document.querySelectorAll('.legend-item').forEach(item => {{
                item.classList.add('active');
                item.classList.remove('inactive');
            }});
            
            // Update graph
            updateGraph();
        }}
        
        // Zoom control functions
        function zoomIn() {{
            svg.transition().duration(300).call(
                zoom.scaleBy, 1.5
            );
        }}
        
        function zoomOut() {{
            svg.transition().duration(300).call(
                zoom.scaleBy, 1 / 1.5
            );
        }}
        
        function resetZoom() {{
            svg.transition().duration(500).call(
                zoom.transform,
                d3.zoomIdentity
            );
        }}
        
        function exportGraph() {{
            const graphData = {{
                nodes: nodes,
                links: links,
                metadata: {{
                    summary: "{summary}",
                    exportTime: new Date().toISOString(),
                    nodeCount: nodes.length,
                    linkCount: links.length,
                    skillCount: skillCount
                }}
            }};
            
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(graphData, null, 2));
            const downloadElement = document.createElement('a');
            downloadElement.setAttribute("href", dataStr);
            downloadElement.setAttribute("download", "professional_knowledge_graph.json");
            downloadElement.click();
        }}
        
        // Drag functions
        function dragstarted(event, d) {{
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }}
        
        function dragged(event, d) {{
            d.fx = event.x;
            d.fy = event.y;
        }}
        
        function dragended(event, d) {{
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }}
        
        // Close info panel when clicking outside
        document.addEventListener('click', function(event) {{
            const panel = document.getElementById('infoPanel');
            const isClickInsidePanel = panel.contains(event.target);
            const isClickOnNode = event.target.tagName === 'circle';
            
            if (!isClickInsidePanel && !isClickOnNode && panel.style.display === 'block') {{
                closeInfoPanel();
            }}
        }});
        
        // Handle window resize
        function handleResize() {{
            const newContainerWidth = document.querySelector('.graph-container').offsetWidth;
            const newWidth = Math.min(newContainerWidth * 0.98, 1400); // Updated to match initial settings
            
            if (Math.abs(newWidth - width) > 50) {{
                // Update SVG dimensions
                svg.attr("width", newWidth)
                   .attr("viewBox", `0 0 ${{newWidth}} ${{height}}`);
                
                // Update center coordinates
                const newCenterX = newWidth / 2;
                
                // Update forces
                simulation.force("center", d3.forceCenter(newCenterX, centerY))
                         .force("x", d3.forceX(newCenterX).strength(0.15))
                         .alpha(0.3).restart();
            }}
        }}
        
        // Add resize listener
        window.addEventListener('resize', handleResize);
        
        // Initial center after a short delay to ensure proper layout
        setTimeout(() => {{
            // Only center the graph without affecting the initial filter state
            const centerX_temp = width / 2;
            const centerY_temp = height / 2;
            
            nodes.forEach(node => {{
                node.fx = centerX_temp + (Math.random() - 0.5) * 150;
                node.fy = centerY_temp + (Math.random() - 0.5) * 150;
            }});
            
            simulation.alpha(0.5).restart();
            
            setTimeout(() => {{
                nodes.forEach(node => {{
                    node.fx = null;
                    node.fy = null;
                }});
            }}, 800);
        }}, 500);
        
        console.log("Professional Knowledge Graph loaded successfully!");
        console.log(`Nodes: ${{nodes.length}}, Links: ${{links.length}}, Skills: ${{skillCount}}`);
        console.log("Filter Features:");
        console.log("  • Click category badges to filter by type");
        console.log("  • Hold Ctrl/Cmd for multi-select");
        console.log("  • Use 'Show All' to reset filters");
    </script>
</body>
</html>
        """
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"✅ Interactive LinkedIn-style visualization saved to: {output_file}")
        return output_file
    
    def process_text_to_knowledge_graph(self, text: str, output_file: str = "knowledge_graph.html") -> str:
        """Main function to process text and generate knowledge graph"""
        print("🧠 Starting Professional Knowledge Graph Generation")
        print("=" * 50)
        
        print("🔍 Extracting skills and competencies from text...")
        knowledge_graph = self.extract_knowledge_graph_from_text(text)
        
        print("🎨 Generating LinkedIn-style interactive visualization...")
        html_file = self.generate_interactive_visualization(knowledge_graph, output_file)
        
        # Save knowledge graph data as JSON
        json_file = output_file.replace('.html', '_data.json')
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(knowledge_graph, f, indent=2, ensure_ascii=False)
        
        print(f"📊 Knowledge graph data saved to: {json_file}")
        print(f"🌐 Open {html_file} in your browser to view the professional graph!")
        
        return html_file
    
    def process_pdf_to_knowledge_graph(self, pdf_path: str, output_file: str = "knowledge_graph.html") -> str:
        """Process PDF resume to knowledge graph"""
        print("📄 Extracting text from PDF...")
        
        try:
            with open(pdf_path, 'rb') as file:
                pdf_content = file.read()
            
            text = extract_text_from_pdf(pdf_content)
            print(f"✅ Extracted {len(text)} characters from PDF")
            
            return self.process_text_to_knowledge_graph(text, output_file)
            
        except Exception as e:
            print(f"❌ Error processing PDF: {e}")
            return ""


def main():
    """Main function to run professional knowledge graph generation"""
    # 您可以在这里选择具体的AI提供商：
    # generator = KnowledgeGraphGenerator("gemini")  # 使用Gemini AI
    generator = KnowledgeGraphGenerator("openai")  # 使用OpenAI
    # generator = KnowledgeGraphGenerator("auto")  # 自动检测最佳AI提供商
    
    # Check if PDF exists
    pdf_path = "CV_20231010docx.pdf"
    if os.path.exists(pdf_path):
        print(f"📄 Processing PDF: {pdf_path}")
        html_file = generator.process_pdf_to_knowledge_graph(pdf_path, "professional_knowledge_graph.html")
    else:
        # Use sample professional text
        sample_text = """
        张梦影是一位经验丰富的RPA开发工程师，目前在毕马威信息技术服务（南京）有限公司工作。
        她具有强大的技术技能，包括C#、ASP.NET Core、Python、JavaScript等编程语言，
        以及UiPath、PowerShell、VBScript等RPA开发工具。她在财务管理和项目管理方面也有丰富经验，
        通过了CPA考试的全部六个模块。她拥有南京航空航天大学企业管理硕士学位和南京林业大学工商管理学士学位。
        在技术项目方面，她开发了多个RPA流程，参与了自动化仪表板开发和智能客服机器人前端开发。
        """
        print("📝 Processing sample professional profile...")
        html_file = generator.process_text_to_knowledge_graph(sample_text, "professional_knowledge_graph.html")
    
    if html_file:
        print("\n" + "=" * 60)
        print("🎉 Professional Knowledge Graph Generation Complete!")
        print("=" * 60)
        print(f"🌐 Open {html_file} in your browser")
        print("✨ LinkedIn-Style Features:")
        print("  • Professional blue-white color scheme")
        print("  • Click any node to see detailed information")
        print("  • Drag nodes to reposition them")
        print("  • Hover for quick tooltips")
        print("  • Skills and competencies focused")
        print("  • Export capability for data analysis")


if __name__ == "__main__":
    main() 