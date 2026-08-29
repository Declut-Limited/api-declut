import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListRolesDto } from './dto/list-roles.dto';
import {
  ADMIN_PERMISSION_MODULES,
  AdminPermissions,
  buildAdminPermissions,
} from '../admin-auth/interfaces/admin-permissions.interface';
import { AdminAuthService } from '../admin-auth/admin-auth.service';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  async create(dto: CreateRoleDto, creatorAdminId: string): Promise<Role> {
    try {
      return await this.roleModel.create({
        name: dto.name,
        permissions: buildAdminPermissions(dto.permissions),
        createdBy: creatorAdminId,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('A role with this name already exists');
      }
      throw err;
    }
  }

  // userCount is computed here, never stored — see the schema comment.
  async findAll(dto: ListRolesDto = {}): Promise<{
    results: Array<Role & { userCount: number }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const [roles, total] = await Promise.all([
      this.roleModel
        .find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.roleModel.countDocuments(),
    ]);
    const counts = await Promise.all(
      roles.map((r) => this.adminAuthService.countByRole(r._id.toString())),
    );
    const results = roles.map((r, i) => ({
      ...(r.toObject() as unknown as Role),
      userCount: counts[i],
    }));
    return { results, total, page, limit };
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.roleModel.findById(id).exec();
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (dto.name !== undefined) {
      role.name = dto.name;
    }
    if (dto.permissions !== undefined) {
      const merged: AdminPermissions = { ...role.permissions };
      for (const moduleKey of ADMIN_PERMISSION_MODULES) {
        const patch = dto.permissions[moduleKey];
        if (!patch) continue;
        merged[moduleKey] = { ...merged[moduleKey], ...patch };
      }
      role.permissions = merged;
    }

    try {
      await role.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('A role with this name already exists');
      }
      throw err;
    }
    return role;
  }

  // Blocks deletion while any admin is still assigned — a dangling role reference would leave those admins denied everything by PermissionsGuard rather than failing loudly here.
  async remove(id: string): Promise<void> {
    const role = await this.roleModel.findById(id).exec();
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    const userCount = await this.adminAuthService.countByRole(id);
    if (userCount > 0) {
      throw new ConflictException(
        `${userCount} admin${userCount === 1 ? ' is' : 's are'} assigned to this role — reassign them before deleting it`,
      );
    }
    await role.deleteOne();
  }
}
