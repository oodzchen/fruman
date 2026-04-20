import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js'

export const LIGHTING_MAX_LIGHTS = 12

type LightingUniformStructure = {
  uAmbient: { value: Float32Array; type: 'vec4<f32>' }
  uLightingMeta: { value: Float32Array; type: 'vec4<f32>' }
  uLightData: {
    value: Float32Array
    type: 'vec4<f32>'
    size: typeof LIGHTING_MAX_LIGHTS
  }
  uLightColor: {
    value: Float32Array
    type: 'vec4<f32>'
    size: typeof LIGHTING_MAX_LIGHTS
  }
}

const DEFAULT_FILTER_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreenPos;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vScreenPos = aPosition * uOutputFrame.zw + uOutputFrame.xy;
}
`

const LIGHTING_FILTER_FRAGMENT = `
in vec2 vTextureCoord;
in vec2 vScreenPos;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uAmbient;
uniform vec4 uLightingMeta;
uniform vec4 uLightData[${LIGHTING_MAX_LIGHTS}];
uniform vec4 uLightColor[${LIGHTING_MAX_LIGHTS}];

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a <= 0.0) {
        finalColor = color;
        return;
    }

    vec3 baseColor = color.rgb / color.a;
    vec3 lighting = uAmbient.rgb * uAmbient.a;
    int lightCount = int(uLightingMeta.x + 0.5);

    for (int i = 0; i < ${LIGHTING_MAX_LIGHTS}; i++) {
        if (i >= lightCount) {
            break;
        }

        vec4 light = uLightData[i];
        float radius = light.z;
        if (radius <= 0.0) {
            continue;
        }

        vec2 delta = vScreenPos - light.xy;
        float normalizedDistanceSq = dot(delta, delta) / (radius * radius);
        float falloff = max(0.0, 1.0 - min(1.0, normalizedDistanceSq));
        falloff *= falloff;
        lighting += uLightColor[i].rgb * (falloff * light.w);
    }

    lighting = min(lighting, vec3(1.55));
    baseColor *= lighting;
    finalColor = vec4(baseColor * color.a, color.a);
}
`

const LIGHTING_FILTER_WGSL = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct LightingUniforms {
  uAmbient: vec4<f32>,
  uLightingMeta: vec4<f32>,
  uLightData: array<vec4<f32>, ${LIGHTING_MAX_LIGHTS}>,
  uLightColor: array<vec4<f32>, ${LIGHTING_MAX_LIGHTS}>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> lightingUniforms: LightingUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) screenPos: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32>
{
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32>
{
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
) -> VSOutput {
  return VSOutput(
    filterVertexPosition(aPosition),
    filterTextureCoord(aPosition),
    aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) screenPos: vec2<f32>
) -> @location(0) vec4<f32> {
    var color = textureSample(uTexture, uSampler, uv);
    if (color.a <= 0.0) {
        return color;
    }

    var baseColor = color.rgb / color.a;
    var lighting = lightingUniforms.uAmbient.rgb * lightingUniforms.uAmbient.a;
    let lightCount = i32(lightingUniforms.uLightingMeta.x + 0.5);

    for (var i = 0; i < ${LIGHTING_MAX_LIGHTS}; i++) {
        if (i >= lightCount) {
            break;
        }

        let light = lightingUniforms.uLightData[i];
        let radius = light.z;
        if (radius <= 0.0) {
            continue;
        }

        let delta = screenPos - light.xy;
        let normalizedDistanceSq = dot(delta, delta) / (radius * radius);
        var falloff = max(0.0, 1.0 - min(1.0, normalizedDistanceSq));
        falloff = falloff * falloff;
        lighting += lightingUniforms.uLightColor[i].rgb * (falloff * light.w);
    }

    lighting = min(lighting, vec3(1.55));
    baseColor *= lighting;
    return vec4(baseColor * color.a, color.a);
}
`

export class LightingFilter extends Filter {
  private readonly lightingUniforms: UniformGroup<LightingUniformStructure>

  constructor() {
    const lightingUniforms = new UniformGroup<LightingUniformStructure>({
      uAmbient: {
        value: new Float32Array(4),
        type: 'vec4<f32>',
      },
      uLightingMeta: {
        value: new Float32Array(4),
        type: 'vec4<f32>',
      },
      uLightData: {
        value: new Float32Array(LIGHTING_MAX_LIGHTS * 4),
        type: 'vec4<f32>',
        size: LIGHTING_MAX_LIGHTS,
      },
      uLightColor: {
        value: new Float32Array(LIGHTING_MAX_LIGHTS * 4),
        type: 'vec4<f32>',
        size: LIGHTING_MAX_LIGHTS,
      },
    })

    const gpuProgram = GpuProgram.from({
      vertex: {
        source: LIGHTING_FILTER_WGSL,
        entryPoint: 'mainVertex',
      },
      fragment: {
        source: LIGHTING_FILTER_WGSL,
        entryPoint: 'mainFragment',
      },
      name: 'scene-lighting-filter',
    })
    const glProgram = GlProgram.from({
      vertex: DEFAULT_FILTER_VERTEX,
      fragment: LIGHTING_FILTER_FRAGMENT,
      name: 'scene-lighting-filter',
    })

    super({
      gpuProgram,
      glProgram,
      resources: {
        lightingUniforms,
      },
    })

    this.lightingUniforms = lightingUniforms
    this.setAmbient(0xffffff, 255)
    this.setLightCount(0)
  }

  getLightDataBuffer(): Float32Array {
    return this.lightingUniforms.uniforms.uLightData
  }

  getLightColorBuffer(): Float32Array {
    return this.lightingUniforms.uniforms.uLightColor
  }

  setAmbient(color: number, intensity255: number): void {
    const ambient = this.lightingUniforms.uniforms.uAmbient
    ambient[0] = ((color >> 16) & 0xff) / 255
    ambient[1] = ((color >> 8) & 0xff) / 255
    ambient[2] = (color & 0xff) / 255
    ambient[3] = Math.max(0, Math.min(255, intensity255)) / 255
  }

  setLightCount(count: number): void {
    const meta = this.lightingUniforms.uniforms.uLightingMeta
    meta[0] = Math.max(0, Math.min(LIGHTING_MAX_LIGHTS, count | 0))
  }

  commit(): void {
    this.lightingUniforms.update()
  }
}
