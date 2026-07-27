import type { PageTranslations } from './zh-Hans'

export const enPageTranslations = {
  page_language: 'Page language',
  language_zh_hans: '简体中文',
  language_en: 'English',
  key_move: 'A / D - Move',
  key_aim_climb: 'W / S - Ranged aim / Grapple climb',
  key_jump: 'Space - Jump',
  key_run: 'Shift + A / D - Run',
  key_roll: 'Ctrl - Roll',
  key_attack: 'J / Left mouse button - Attack',
  key_defend_aim: 'K / Right mouse button - Melee defense / Toggle ranged aim',
  key_skill: 'F - Weapon skill',
  key_lock: 'Q - Lock/unlock (hold and move mouse to switch target)',
  key_interact: 'E - Interact/pick up',
  key_grapple_recover: 'R - Grapple (hold) / Recover',
  key_middle_grapple: 'Middle mouse button - Grapple',
  key_ultimate: 'E + Middle mouse button - Ultimate',
  key_switch_weapon: '1 / 2 - Switch primary / secondary weapon',
  key_camera_controls: 'I / O / U - Zoom in / Zoom out / Reset camera',
  key_camera_wheel: 'Mouse wheel - Camera zoom',
  key_pause: 'Esc - Pause/resume',
  control_title: 'Game Controls',
  control_pause: 'Pause',
  control_pause_title: 'Pause or resume the game',
  control_resume: 'Resume',
  control_restart: 'Restart',
  control_restart_title:
    'Restart the game and return the character to the starting position',
  control_kill: 'Kill',
  control_kill_title: 'Kill the character and enter ragdoll state',
  control_revive: 'Revive',
  control_revive_title: 'Revive the character and return to standing',
  section_jump: 'Jump Parameters',
  section_friction: 'Friction and Damping',
  section_movement: 'Movement Parameters',
  section_crate: 'Intact Crate Parameters',
  section_camera: 'Camera Debugging',
  section_rope: 'Rope Physics Parameters',
  param_jump_force: 'Jump Force',
  param_jump_force_title: 'Initial upward jump velocity',
  param_jump_buffer: 'Jump Buffer Time (ms)',
  param_jump_buffer_title:
    'Input buffer (ms): jump automatically on landing if jump was pressed in the air within this time',
  param_jump_duration: 'Jump Duration (ms)',
  param_jump_duration_title:
    'Maximum duration of upward force while holding jump',
  param_sustained_jump: 'Sustained Jump Multiplier',
  param_sustained_jump_title: 'Sustained jump force relative to jumpForce',
  param_wall_jump_horizontal: 'Wall Jump Horizontal Multiplier',
  param_wall_jump_horizontal_title:
    'Horizontal wall push-off velocity relative to moveSpeed',
  param_wall_jump_vertical: 'Wall Jump Vertical Multiplier',
  param_wall_jump_vertical_title:
    'Upward wall-jump velocity relative to jumpForce',
  param_max_wall_jumps: 'Max Wall Jumps',
  param_max_wall_jumps_title:
    'Maximum wall jumps allowed before touching the ground',
  param_ground_friction: 'Ground Friction',
  param_ground_friction_title:
    'Friction when the character contacts the ground',
  param_obstacle_friction: 'Obstacle Friction',
  param_obstacle_friction_title:
    'Friction when the character contacts an obstacle',
  param_body_friction: 'Body Friction',
  param_body_friction_title:
    'Friction between the circular character body and other objects',
  param_linear_damping: 'Body Linear Damping',
  param_linear_damping_title:
    'Linear damping that suppresses movement of the circular character body',
  param_move_speed: 'Move Speed',
  param_move_speed_title: 'Character movement speed',
  param_breakable_crate_density: 'Crate Density',
  param_breakable_crate_density_title:
    'Density of intact crates; affects weight, forces, and stacking stability',
  param_breakable_crate_friction: 'Crate Friction',
  param_breakable_crate_friction_title:
    'Contact friction of intact crates; higher values reduce sliding',
  param_breakable_crate_linear_damping: 'Crate Linear Damping',
  param_breakable_crate_linear_damping_title:
    'Linear damping that suppresses sliding of intact crates',
  param_breakable_crate_angular_damping: 'Crate Angular Damping',
  param_breakable_crate_angular_damping_title:
    'Angular damping that suppresses tipping and rotation of intact crates',
  param_breakable_crate_restitution: 'Crate Restitution',
  param_breakable_crate_restitution_title:
    'Restitution of intact crates; higher values increase bounce',
  param_camera_zoom: 'Camera Zoom',
  param_camera_zoom_title:
    'Camera zoom multiplier (also adjustable with the mouse wheel)',
  param_rope_density: 'Rope Density',
  param_rope_density_title:
    'Density of rope segments; affects rope weight and stability',
  param_rope_linear_damping: 'Rope Linear Damping',
  param_rope_linear_damping_title:
    'Linear damping of rope segments; affects swing duration and jitter',
  param_rope_hertz: 'Rope Spring Frequency (Hz)',
  param_rope_hertz_title:
    'Rope joint spring frequency; high values can cause numerical jitter in segmented ropes',
  param_rope_damping_ratio: 'Rope Spring Damping Ratio',
  param_rope_damping_ratio_title:
    'Rope spring damping ratio; 1 is near critical damping, while higher values suppress bounce faster',
  param_rope_bend_stiffness: 'Rope Bend Stiffness',
  param_rope_bend_stiffness_title:
    'Normal correction strength for rope bends; high values make the rope rigid and reduce swinging',
  param_rope_elastic_limit_scale: 'Rope Stretch Limit Scale',
  param_rope_elastic_limit_scale_title:
    'Length ratio allowed before the rope reaches its stretch limit; lower values engage tension earlier',
  param_rope_climb_linear_damping: 'Climb Rope Linear Damping',
  param_rope_climb_linear_damping_title:
    'Linear damping of rope segments while climbing a bridge rope',
  param_rope_climb_hertz: 'Climb Rope Spring Frequency (Hz)',
  param_rope_climb_hertz_title:
    'Rope joint spring frequency while climbing; high values can cause numerical jitter',
  param_rope_climb_damping_ratio: 'Climb Rope Spring Damping Ratio',
  param_rope_climb_damping_ratio_title:
    'Rope spring damping ratio while climbing; higher values suppress bounce faster',
  param_rope_climb_weight_force_scale: 'Climb Weight Force Scale',
  param_rope_climb_weight_force_scale_title:
    'Proportion of character weight applied to the bridge rope while climbing',
  param_swing_force: 'Swing Force',
  param_swing_force_title:
    'Tangential swing velocity applied while pressing direction keys',
  ui_reset: 'Reset',
  ui_reset_parameter: 'Reset: {0}',
  map_import: 'Import',
  map_importing: 'Importing...',
  map_export: 'Export',
  map_exporting: 'Exporting...',
  map_export_failed: 'Export failed',
  map_exported: 'Exported',
  map_invalid_archive: 'Invalid archive format',
  map_invalid_data: 'Invalid map file',
  map_import_succeeded: 'Import succeeded',
  map_import_failed: 'Import failed',
} satisfies PageTranslations
