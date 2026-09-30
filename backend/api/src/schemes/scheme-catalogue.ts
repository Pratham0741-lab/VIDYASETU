import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { DbContext } from '../database/db-context';

/** One active scheme version (Phase 17.2, GET /schemes). */
export class ActiveSchemeVersionDto {
  @ApiProperty({ example: 'NFST' }) scheme_code!: string;
  @ApiProperty({ example: 'National Fellowship for Higher Education of ST Students' })
  scheme_name!: string;
  @ApiProperty({ example: 5 }) version_no!: number;
  @ApiProperty({ format: 'uuid' }) scheme_version_id!: string;
  @ApiProperty({ format: 'date', example: '2026-09-28' }) effective_from!: string;
  @ApiProperty({ format: 'date', nullable: true, type: String }) effective_to!: string | null;
}

export class ActiveSchemesDto {
  @ApiProperty({ type: [ActiveSchemeVersionDto], description: 'Ordered by scheme code.' })
  schemes!: ActiveSchemeVersionDto[];
}

interface Row {
  scheme_code: string;
  scheme_name: string;
  version_no: number;
  scheme_version_id: string;
  effective_from: Date;
  effective_to: Date | null;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Phase 17.2: the public catalogue of schemes open to applications - the
 * version of each scheme whose status is 'active' (the one POST /applications
 * accepts), and nothing else: no drafts, archived or retired versions, no
 * configuration. Schemes registered as test fixtures (test_fixtures) are left
 * out, as analytics leaves them out by default.
 */
@Injectable()
export class SchemeCatalogueService {
  constructor(private readonly db: DbContext) {}

  async active(): Promise<ActiveSchemesDto> {
    const rows = await this.db.client.$queryRaw<Row[]>`
      SELECT s.code AS scheme_code, s.name AS scheme_name, v.version_no, v.id::text AS scheme_version_id,
             v.effective_from, v.effective_to
        FROM scheme_versions v
        JOIN schemes s ON s.id = v.scheme_id
       WHERE v.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type = 'scheme' AND f.entity_id = s.id)
       ORDER BY s.code, v.version_no`;
    return {
      schemes: rows.map((r) => ({
        scheme_code: r.scheme_code,
        scheme_name: r.scheme_name,
        version_no: Number(r.version_no),
        scheme_version_id: r.scheme_version_id,
        effective_from: day(r.effective_from)!,
        effective_to: day(r.effective_to),
      })),
    };
  }
}
